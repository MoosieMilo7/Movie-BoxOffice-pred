import json
import os
from datetime import datetime, timezone
import anthropic
from dotenv import load_dotenv

from ..db.database import db, execute_write
from .scoring.structural import compute_structural_score
from .scoring.sentiment  import compute_sentiment_score
from .scoring.momentum   import compute_momentum_score
from .scoring.market     import compute_market_score
from .scoring.comps      import compute_comp_score
from .scoring.confidence import compute_confidence
from .exchange_rates     import CURRENCY_MAP, get_rate

load_dotenv()

METHODOLOGY_VERSION  = 'v2.0'
CLAUDE_MODEL         = 'claude-sonnet-4-6'
COMP_AVG_FINAL_SCORE = 0.55

ORIGIN_SPLITS = {
    'hollywood': 0.55, 'bollywood': 0.72, 'korean': 0.58,
    'japanese':  0.78, 'european':  0.45,
}

ORIGIN_COUNTRY_MAP = {
    'hollywood': 'United States', 'bollywood': 'India',
    'korean':    'South Korea',   'japanese':  'Japan',
}

EU_COUNTRY_NAMES = {
    'GB': 'United Kingdom', 'FR': 'France',  'ES': 'Spain',
    'IT': 'Italy',          'DE': 'Germany', 'SE': 'Sweden',
    'DK': 'Denmark',        'NO': 'Norway',  'NL': 'Netherlands',
}

RELEASED_OW_RATES = {
    'hollywood': {'global_rate': 0.22, 'domestic_pct': 0.40, 'domestic_ow_rate': 0.18},
    'bollywood': {'global_rate': 0.25, 'domestic_pct': 0.65, 'domestic_ow_rate': 0.40},
    'korean':    {'global_rate': 0.28, 'domestic_pct': 0.40, 'domestic_ow_rate': 0.35},
    'japanese':  {'global_rate': 0.30, 'domestic_pct': 0.85, 'domestic_ow_rate': 0.45},
    'european':  {'global_rate': 0.15, 'domestic_pct': 0.30, 'domestic_ow_rate': 0.12},
}

FALLBACK = {
    'structural': {'score': 0.40, 'components': {'budget': {}, 'franchise': {}, 'genre': {}, 'talent': {}, 'mpaa': {}}},
    'sentiment':  {'score': 0.35, 'data_available': False, 'label': None, 'one_line': None},
    'momentum':   {'score': 0.30, 'components': {'mention_velocity': {}, 'trailer_velocity': {}, 'volume': {}}, 'data_available': False},
    'market':     {'score': 0.50, 'components': {'season': {'score': 0.50, 'label': 'unknown'}, 'competition': {'score': 1.0, 'major_competitor_count': 0, 'competitor_titles': []}}},
    'comps':      {'score': 0.30, 'weighted_ow_global_usd': None, 'comps_found': 0, 'comps_used': [], 'data_available': False},
    'confidence': {'level': 'low', 'range_multiplier': 0.60, 'days_until_release': None, 'reason': 'Scoring failed'},
}

_anthropic_client = None


def _get_anthropic():
    global _anthropic_client
    if not os.getenv('ANTHROPIC_API_KEY'):
        raise ValueError('ANTHROPIC_API_KEY not set')
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
    return _anthropic_client


def _safe_parse(v, fallback):
    if v is None:
        return fallback
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return fallback


def _r2(n): return round(n * 100) / 100
def _r4(n): return round(n * 10_000) / 10_000


def _get_budget_multiplier(budget):
    if budget >= 150_000_000: return 0.35
    if budget >= 80_000_000:  return 0.26
    if budget >= 25_000_000:  return 0.18
    if budget >= 5_000_000:   return 0.10
    return 0.05


def _get_origin_country(film):
    mkt = film.get('market') or 'hollywood'
    if mkt != 'european':
        return ORIGIN_COUNTRY_MAP.get(mkt, 'United States')
    countries = _safe_parse(film.get('production_countries'), [])
    for code, name in EU_COUNTRY_NAMES.items():
        if any(c.get('iso_3166_1') == code for c in countries):
            return name
    return 'Europe'


def _build_key_drivers(structural, sentiment, momentum, market, comps):
    drivers = []
    budget      = structural.get('components', {}).get('budget', {})
    franchise   = structural.get('components', {}).get('franchise', {})
    talent      = structural.get('components', {}).get('talent', {})
    mention_vel = momentum.get('components', {}).get('mention_velocity', {})
    trailer_vel = momentum.get('components', {}).get('trailer_velocity', {})
    season      = market.get('components', {}).get('season', {})
    competition = market.get('components', {}).get('competition', {})

    if budget.get('tier') == 'tentpole':
        drivers.append('Tentpole budget signals wide release')
    if (franchise.get('score') or 0) >= 0.80:
        drivers.append('Major franchise IP with proven audience')
    elif (franchise.get('score') or 0) >= 0.65:
        drivers.append('Franchise IP reduces audience uncertainty')
    if (sentiment.get('score') or 0) >= 0.75:
        drivers.append('High pre-release social sentiment')
    elif (sentiment.get('score') or 0) >= 0.55:
        drivers.append('Positive audience sentiment building')
    if mention_vel.get('velocity_pct') is not None and mention_vel['velocity_pct'] >= 30:
        drivers.append('Accelerating social buzz')
    if trailer_vel.get('velocity_pct') is not None and trailer_vel['velocity_pct'] >= 50:
        drivers.append('Viral trailer performance')
    if (season.get('score') or 0) >= 0.85:
        drivers.append('Premium release window (summer/holiday)')
    if competition.get('score') == 1.00:
        drivers.append('Clear market leader — no major competition')
    if (talent.get('director_score') or 0) >= 0.65:
        drivers.append('Director has strong box office track record')
    if (comps.get('comps_found') or 0) >= 3:
        avg = comps.get('weighted_ow_global_usd')
        avg_str = f'{avg:.0f}' if avg else '?'
        drivers.append(f'Strong comp anchor from similar films: Similar films averaged ${avg_str}m global OW')

    return drivers[:3]


def _build_risk_factors(film, structural, sentiment, momentum, market, comps):
    risks = []
    budget      = structural.get('components', {}).get('budget', {})
    franchise   = structural.get('components', {}).get('franchise', {})
    genre       = structural.get('components', {}).get('genre', {})
    mention_vel = momentum.get('components', {}).get('mention_velocity', {})
    competition = market.get('components', {}).get('competition', {})

    if not sentiment.get('data_available'):
        risks.append('No social signal yet — prediction based on structural factors only')
    if film.get('budget_inferred') and not (film.get('budget') or 0 > 0):
        risks.append('Budget unconfirmed — using franchise inference')
    elif not (film.get('budget') or 0 > 0) and not film.get('budget_inferred'):
        risks.append('Budget unknown — significant uncertainty')
    if (franchise.get('score') or 1) < 0.40 and budget.get('tier') not in ('tentpole', 'major'):
        risks.append('Original IP without franchise safety net')
    if mention_vel.get('velocity_pct') is not None and mention_vel['velocity_pct'] < -10:
        risks.append('Buzz declining — negative momentum signal')
    if (competition.get('score') or 1) <= 0.50:
        titles = (competition.get('competitor_titles') or [])[:2]
        suffix = f' ({", ".join(titles)})' if titles else ''
        risks.append(f'Competitive release window{suffix}')
    EXEMPT_GENRES = {'Horror', 'Crime', 'Thriller'}
    if film.get('mpaa_rating') == 'R' and genre.get('primary_genre') not in EXEMPT_GENRES:
        risks.append('Restricted rating limits audience ceiling')
    if (comps.get('comps_found') or 0) < 3:
        risks.append('Limited comp data — fewer than 3 similar films')

    return risks[:3]


async def _generate_analyst_report(film, ow, scores, confidence, key_drivers, risk_factors, comps):
    try:
        client = _get_anthropic()
        origin_country = _get_origin_country(film)
        comps_list = '\n'.join(
            f"{c['title']}: ${c['actual_ow_global_usd']}M global OW"
            for c in (comps.get('comps_used') or [])
        ) or 'No comparable films found'

        user_msg = f"""Generate analyst report for:

Title: {film.get('title')}
Release: {film.get('release_date') or 'TBD'} ({confidence.get('days_until_release', 'unknown')} days out)
Market: {film.get('market')}
Status: {film.get('status')}

PROJECTION:
Global OW: ${ow['global_ow_low']}M – ${ow['global_ow_high']}M
Origin ({origin_country}): ${ow['origin_ow_low']}M – ${ow['origin_ow_high']}M
Confidence: {confidence.get('level')}

SCORE BREAKDOWN:
Structural: {scores['structural']}/1.0
Sentiment: {scores['sentiment']}/1.0
Momentum: {scores['momentum']}/1.0
Market: {scores['market']}/1.0
Comp anchor: {scores['comps']}/1.0

COMP FILMS USED:
{comps_list}

KEY DRIVERS: {', '.join(key_drivers)}
RISK FACTORS: {', '.join(risk_factors)}
CONFIDENCE REASON: {confidence.get('reason')}"""

        resp = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=250,
            temperature=0,
            system=(
                'You are a senior film acquisition analyst writing brief reports for streaming rights buyers.\n'
                'Write exactly 3 sentences. No more, no less.\n'
                'Sentence 1: State the film\'s current market position and the single strongest signal.\n'
                'Sentence 2: Explain what is driving the projection using the specific numbers provided.\n'
                'Sentence 3: State the primary risk or uncertainty that could move the number in either direction.\n'
                'Rules: Use specific numbers from the data. No filler phrases. Do not invent information not provided. Do not exceed 3 sentences.'
            ),
            messages=[{'role': 'user', 'content': user_msg}],
        )
        return ''.join(b.text for b in resp.content if b.type == 'text').strip()
    except Exception as e:
        print(f'[PREDICTOR] Claude API failed, skipping report: {e}')
        return None


async def generate_prediction(film):
    print(f'\n[PREDICTOR] ── Starting prediction for "{film.get("title")}" (tmdb_id={film.get("tmdb_id")}) ──')

    structural = FALLBACK['structural']
    try:
        structural = compute_structural_score(film)
        print(f'[PREDICTOR] structural:  {structural["score"]}')
    except Exception as e:
        print(f'[PREDICTOR] structural failed: {e}')

    sentiment = FALLBACK['sentiment']
    try:
        sentiment = compute_sentiment_score(film.get('id'))
        print(f'[PREDICTOR] sentiment:   {sentiment["score"]} ({"data" if sentiment["data_available"] else "no data"})')
    except Exception as e:
        print(f'[PREDICTOR] sentiment failed: {e}')

    momentum = FALLBACK['momentum']
    try:
        momentum = compute_momentum_score(film.get('id'))
        print(f'[PREDICTOR] momentum:    {momentum["score"]} (data={momentum["data_available"]})')
    except Exception as e:
        print(f'[PREDICTOR] momentum failed: {e}')

    market = FALLBACK['market']
    try:
        market = compute_market_score(film)
        season_label = market['components']['season']['label']
        n_comp = market['components']['competition']['major_competitor_count']
        print(f'[PREDICTOR] market:      {market["score"]} (season={season_label}, competitors={n_comp})')
    except Exception as e:
        print(f'[PREDICTOR] market failed: {e}')

    comps = FALLBACK['comps']
    try:
        comps = await compute_comp_score(film)
        print(f'[PREDICTOR] comps:       {comps["score"]} ({comps["comps_found"]} comps, global_ow=${comps.get("weighted_ow_global_usd")}M)')
    except Exception as e:
        print(f'[PREDICTOR] comps failed: {e}')

    confidence = FALLBACK['confidence']
    try:
        confidence = compute_confidence(film, sentiment, comps)
        days = confidence.get('days_until_release')
        rang = confidence.get('range_multiplier')
        print(f'[PREDICTOR] confidence:  {confidence["level"]} (range ±{rang * 100:.0f}%, {days} days out)')
    except Exception as e:
        print(f'[PREDICTOR] confidence failed: {e}')

    final_score = _r4(
        structural['score'] * 0.25 +
        sentiment['score']  * 0.30 +
        momentum['score']   * 0.20 +
        market['score']     * 0.10 +
        comps['score']      * 0.15
    )
    print(f'[PREDICTOR] final_score: {final_score}')

    if comps.get('data_available') and (comps.get('weighted_ow_global_usd') or 0) > 0:
        scale = max(0.30, min(final_score / COMP_AVG_FINAL_SCORE, 2.50))
        global_ow_mid = _r2(comps['weighted_ow_global_usd'] * scale)
        print(f'[PREDICTOR] comp anchor: ${comps["weighted_ow_global_usd"]}M × scale {scale:.3f} = ${global_ow_mid}M')
    else:
        budget = (film.get('budget') or 0) or 150_000_000
        budget_mult   = _get_budget_multiplier(budget)
        sentiment_mult = 0.60 + (sentiment['score'] * 0.80)
        global_ow_mid = _r2((budget * budget_mult * sentiment_mult) / 1_000_000)
        print(f'[PREDICTOR] budget anchor fallback used → ${global_ow_mid}M')

    origin_split  = ORIGIN_SPLITS.get(film.get('market') or 'hollywood', 0.55)
    origin_ow_mid = _r2(global_ow_mid * origin_split)
    range_mult    = confidence.get('range_multiplier', 0.60)

    ow = {
        'global_ow_low':  _r2(global_ow_mid * (1 - range_mult)),
        'global_ow_mid':  global_ow_mid,
        'global_ow_high': _r2(global_ow_mid * (1 + range_mult)),
        'origin_ow_low':  _r2(origin_ow_mid * (1 - range_mult)),
        'origin_ow_mid':  origin_ow_mid,
        'origin_ow_high': _r2(origin_ow_mid * (1 + range_mult)),
    }

    mkt      = film.get('market') or 'hollywood'
    cur_info = CURRENCY_MAP.get(mkt, CURRENCY_MAP['hollywood'])
    rate     = await get_rate(cur_info['code'])

    def to_local(usd_m):
        return _r2(usd_m * rate * 1_000_000)

    origin_ow_local_low  = to_local(ow['origin_ow_low'])
    origin_ow_local_mid  = to_local(ow['origin_ow_mid'])
    origin_ow_local_high = to_local(ow['origin_ow_high'])

    origin_country = _get_origin_country(film)
    key_drivers    = _build_key_drivers(structural, sentiment, momentum, market, comps)
    risk_factors   = _build_risk_factors(film, structural, sentiment, momentum, market, comps)

    scores = {
        'structural': structural['score'], 'sentiment': sentiment['score'],
        'momentum':   momentum['score'],   'market':    market['score'],
        'comps':      comps['score'],
    }
    analyst_report = await _generate_analyst_report(film, ow, scores, confidence, key_drivers, risk_factors, comps)

    generated_at = datetime.now(timezone.utc).isoformat()
    comp_films_used = [
        {'title': c['title'], 'actual_ow_global_usd': c['actual_ow_global_usd']}
        for c in (comps.get('comps_used') or [])
    ]

    rowid = execute_write(
        '''INSERT INTO predictions (
              film_id, generated_at, days_until_release,
              structural_score, sentiment_score, momentum_score, market_score, comp_score, final_score,
              origin_ow_low, origin_ow_mid, origin_ow_high,
              origin_country, origin_currency,
              origin_ow_local_low, origin_ow_local_mid, origin_ow_local_high,
              global_ow_low, global_ow_mid, global_ow_high,
              confidence, confidence_reason,
              key_drivers, risk_factors, comp_films_used,
              analyst_report, methodology_version
           ) VALUES (
              :film_id, :generated_at, :days_until_release,
              :structural_score, :sentiment_score, :momentum_score, :market_score, :comp_score, :final_score,
              :origin_ow_low, :origin_ow_mid, :origin_ow_high,
              :origin_country, :origin_currency,
              :origin_ow_local_low, :origin_ow_local_mid, :origin_ow_local_high,
              :global_ow_low, :global_ow_mid, :global_ow_high,
              :confidence, :confidence_reason,
              :key_drivers, :risk_factors, :comp_films_used,
              :analyst_report, :methodology_version
           )''',
        {
            'film_id':             film['id'],
            'generated_at':        generated_at,
            'days_until_release':  confidence.get('days_until_release'),
            'structural_score':    structural['score'],
            'sentiment_score':     sentiment['score'],
            'momentum_score':      momentum['score'],
            'market_score':        market['score'],
            'comp_score':          comps['score'],
            'final_score':         final_score,
            'origin_ow_low':       ow['origin_ow_low'],
            'origin_ow_mid':       ow['origin_ow_mid'],
            'origin_ow_high':      ow['origin_ow_high'],
            'origin_country':      origin_country,
            'origin_currency':     cur_info['code'],
            'origin_ow_local_low': origin_ow_local_low,
            'origin_ow_local_mid': origin_ow_local_mid,
            'origin_ow_local_high':origin_ow_local_high,
            'global_ow_low':       ow['global_ow_low'],
            'global_ow_mid':       ow['global_ow_mid'],
            'global_ow_high':      ow['global_ow_high'],
            'confidence':          confidence['level'],
            'confidence_reason':   confidence['reason'],
            'key_drivers':         json.dumps(key_drivers),
            'risk_factors':        json.dumps(risk_factors),
            'comp_films_used':     json.dumps(comp_films_used),
            'analyst_report':      analyst_report,
            'methodology_version': METHODOLOGY_VERSION,
        }
    )
    print(f'[PREDICTOR] Prediction stored, id: {rowid}')

    return {
        'film': {
            'tmdb_id':      film.get('tmdb_id'),
            'title':        film.get('title'),
            'market':       film.get('market'),
            'status':       film.get('status'),
            'release_date': film.get('release_date'),
            'poster_path':  film.get('poster_path'),
        },
        'prediction': {
            'generated_at':       generated_at,
            'days_until_release': confidence.get('days_until_release'),
            'confidence':         confidence['level'],
            'confidence_reason':  confidence['reason'],
            'opening_weekend': {
                'origin_market': {
                    'country':         origin_country,
                    'currency_code':   cur_info['code'],
                    'currency_symbol': cur_info['symbol'],
                    'low_usd':         ow['origin_ow_low'],
                    'mid_usd':         ow['origin_ow_mid'],
                    'high_usd':        ow['origin_ow_high'],
                    'low_local':       origin_ow_local_low,
                    'mid_local':       origin_ow_local_mid,
                    'high_local':      origin_ow_local_high,
                },
                'global': {
                    'low_usd':  ow['global_ow_low'],
                    'mid_usd':  ow['global_ow_mid'],
                    'high_usd': ow['global_ow_high'],
                },
            },
            'score_breakdown': {
                'structural': structural['score'],
                'sentiment':  sentiment['score'],
                'momentum':   momentum['score'],
                'market':     market['score'],
                'comps':      comps['score'],
                'final':      final_score,
            },
            'key_drivers':    key_drivers,
            'risk_factors':   risk_factors,
            'comp_films':     comp_films_used,
            'analyst_report': analyst_report,
        },
        'sentiment_pending':   not sentiment.get('data_available'),
        'methodology_version': METHODOLOGY_VERSION,
    }


async def _generate_performance_analysis(film, ow_global_m, ow_origin_m):
    try:
        client = _get_anthropic()
        revenue = film.get('revenue') or 0
        budget  = film.get('budget') or 0
        roi     = f'{((revenue - budget) / budget * 100):.0f}%' if budget > 0 else None
        year    = film['release_date'][:4] if film.get('release_date') else 'unknown'
        roi_str = f' | ROI: {roi}' if roi else ''

        resp = await client.messages.create(
            model=CLAUDE_MODEL, max_tokens=120, temperature=0,
            system='You are a film industry box office analyst. Write concise, data-driven performance assessments. Use specific numbers. No filler.',
            messages=[{'role': 'user', 'content':
                f'Assess: {film.get("title")} ({year}) | Market: {film.get("market") or "hollywood"} | '
                f'Budget: {"$" + str(_r2(budget / 1_000_000)) + "M" if budget > 0 else "unknown"} | '
                f'WW Revenue: ${_r2(revenue / 1_000_000)}M | '
                f'Est. OW Global: ~${ow_global_m:.0f}M | Est. OW Domestic: ~${ow_origin_m:.0f}M{roi_str}\n'
                f'Write exactly 2 sentences: (1) Hit/miss/moderate with specific numbers. (2) Key driver or factor. Max 55 words total.'
            }],
        )
        return ''.join(b.text for b in resp.content if b.type == 'text').strip() or None
    except Exception as e:
        print(f'[PREDICTOR] Performance analysis failed: {e}')
        return None


async def generate_released_film_data(film):
    revenue = film.get('revenue') or 0
    budget  = film.get('budget') or 0
    market  = (film.get('market') or 'hollywood').lower()
    rates   = RELEASED_OW_RATES.get(market, RELEASED_OW_RATES['hollywood'])
    cur_info = CURRENCY_MAP.get(market, CURRENCY_MAP['hollywood'])

    ow_global_mid  = _r2(revenue / 1_000_000 * rates['global_rate'])
    ow_origin_mid  = _r2(revenue / 1_000_000 * rates['domestic_pct'] * rates['domestic_ow_rate'])
    ow_global_low  = _r2(ow_global_mid * 0.82)
    ow_global_high = _r2(ow_global_mid * 1.18)
    ow_origin_low  = _r2(ow_origin_mid * 0.82)
    ow_origin_high = _r2(ow_origin_mid * 1.18)

    roi = _r2(((revenue - budget) / budget) * 100) if budget > 0 else None
    performance_tier = 'moderate'
    if budget > 0:
        if revenue >= budget * 2.5:   performance_tier = 'hit'
        elif revenue >= budget * 1.5: performance_tier = 'moderate_hit'
        elif revenue < budget * 1.0:  performance_tier = 'miss'

    print(f'[PREDICTOR][RELEASED] Generating performance analysis for "{film.get("title")}"')
    analysis      = await _generate_performance_analysis(film, ow_global_mid, ow_origin_mid)
    origin_country = _get_origin_country(film)

    return {
        'mode':                          'released',
        'actual_worldwide_gross':        revenue,
        'actual_worldwide_gross_millions': _r2(revenue / 1_000_000),
        'budget_millions':               _r2(budget / 1_000_000) if budget > 0 else None,
        'roi_percent':                   roi,
        'performance_tier':              performance_tier,
        'analyst_report':                analysis,
        'opening_weekend': {
            'origin_market': {
                'country': origin_country, 'currency_code': cur_info['code'],
                'currency_symbol': cur_info['symbol'],
                'low_usd': ow_origin_low, 'mid_usd': ow_origin_mid, 'high_usd': ow_origin_high,
                'estimated': True,
            },
            'global': {
                'low_usd': ow_global_low, 'mid_usd': ow_global_mid, 'high_usd': ow_global_high,
                'estimated': True,
            },
        },
        'note': 'Opening weekend figures are estimates derived from total worldwide revenue using historical market performance patterns.',
    }
