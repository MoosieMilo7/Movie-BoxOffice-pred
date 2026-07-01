import json
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

from ..db.database import db, execute_write, fetchone, fetchall
from ..services.tmdb       import search_film, get_film_details, get_watch_providers
from ..services.predictor  import generate_prediction, generate_released_film_data
from ..services.film_mode  import determine_film_mode

router = APIRouter()

VALID_MARKETS = {'hollywood', 'bollywood', 'korean', 'japanese', 'european'}
CURRENCY_SYMBOLS = {'USD': '$', 'INR': '₹', 'KRW': '₩', 'JPY': '¥', 'EUR': '€'}
PREDICTABLE_STATUSES = ('upcoming', 'in_production', 'fresh_release')
PROVIDERS_CACHE_TTL_S = 7 * 24 * 60 * 60  # 7 days


def _safe_parse(v, fallback):
    if v is None:
        return fallback
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return fallback


def _format_film(film):
    return {
        **film,
        'genres':                _safe_parse(film.get('genres'), []),
        'cast_top5':             _safe_parse(film.get('cast_top5'), []),
        'director':              _safe_parse(film.get('director'), None),
        'production_companies':  _safe_parse(film.get('production_companies'), []),
        'production_countries':  _safe_parse(film.get('production_countries'), []),
        'belongs_to_collection': _safe_parse(film.get('belongs_to_collection'), None),
        'budget_inferred':       bool(film.get('budget_inferred')),
    }


def _format_stored_prediction(row):
    if not row:
        return None
    return {
        'generated_at':       row['generated_at'],
        'days_until_release': row['days_until_release'],
        'confidence':         row['confidence'],
        'confidence_reason':  row['confidence_reason'],
        'opening_weekend': {
            'origin_market': {
                'country':         row['origin_country'],
                'currency_code':   row['origin_currency'],
                'currency_symbol': CURRENCY_SYMBOLS.get(row['origin_currency'], row['origin_currency']),
                'low_usd':         row['origin_ow_low'],
                'mid_usd':         row['origin_ow_mid'],
                'high_usd':        row['origin_ow_high'],
                'low_local':       row['origin_ow_local_low'],
                'mid_local':       row['origin_ow_local_mid'],
                'high_local':      row['origin_ow_local_high'],
            },
            'global': {
                'low_usd':  row['global_ow_low'],
                'mid_usd':  row['global_ow_mid'],
                'high_usd': row['global_ow_high'],
            },
        },
        'score_breakdown': {
            'structural': row['structural_score'],
            'sentiment':  row['sentiment_score'],
            'momentum':   row['momentum_score'],
            'market':     row['market_score'],
            'comps':      row['comp_score'],
            'final':      row['final_score'],
        },
        'key_drivers':    _safe_parse(row['key_drivers'], []),
        'risk_factors':   _safe_parse(row['risk_factors'], []),
        'comp_films':     _safe_parse(row['comp_films_used'], []),
        'analyst_report': row['analyst_report'],
        'methodology_version': row['methodology_version'],
    }


def _get_latest_prediction(film_id):
    return fetchone(
        'SELECT * FROM predictions WHERE film_id=? ORDER BY generated_at DESC LIMIT 1',
        (film_id,)
    )


def _upsert_film(d, status_override=None):
    execute_write(
        '''INSERT INTO films (
              tmdb_id, title, overview, market, status, release_date,
              budget, revenue, runtime, genres, cast_top5, director,
              production_companies, production_countries, original_language,
              poster_path, trailer_url, belongs_to_collection, mpaa_rating,
              vote_average, vote_count, popularity,
              budget_inferred, budget_source, last_tmdb_sync
           ) VALUES (
              :tmdb_id, :title, :overview, :market, :status, :release_date,
              :budget, :revenue, :runtime, :genres, :cast_top5, :director,
              :production_companies, :production_countries, :original_language,
              :poster_path, :trailer_url, :belongs_to_collection, :mpaa_rating,
              :vote_average, :vote_count, :popularity,
              :budget_inferred, :budget_source, :last_tmdb_sync
           )
           ON CONFLICT(tmdb_id) DO UPDATE SET
              title=excluded.title, overview=excluded.overview,
              market=excluded.market, status=excluded.status,
              release_date=excluded.release_date, budget=excluded.budget,
              revenue=excluded.revenue, runtime=excluded.runtime,
              genres=excluded.genres, cast_top5=excluded.cast_top5,
              director=excluded.director,
              production_companies=excluded.production_companies,
              production_countries=excluded.production_countries,
              original_language=excluded.original_language,
              poster_path=excluded.poster_path, trailer_url=excluded.trailer_url,
              belongs_to_collection=excluded.belongs_to_collection,
              mpaa_rating=excluded.mpaa_rating,
              vote_average=excluded.vote_average, vote_count=excluded.vote_count,
              popularity=excluded.popularity, budget_inferred=excluded.budget_inferred,
              budget_source=excluded.budget_source, last_tmdb_sync=excluded.last_tmdb_sync''',
        {
            'tmdb_id':               d['tmdb_id'],
            'title':                 d['title'],
            'overview':              d.get('overview'),
            'market':                d.get('market') or 'hollywood',
            'status':                status_override or d.get('status') or 'upcoming',
            'release_date':          d.get('release_date'),
            'budget':                d.get('budget') or 0,
            'revenue':               d.get('revenue') or 0,
            'runtime':               d.get('runtime'),
            'genres':                json.dumps(d.get('genres') or []),
            'cast_top5':             json.dumps(d.get('cast_top5') or []),
            'director':              json.dumps(d.get('director')),
            'production_companies':  json.dumps(d.get('production_companies') or []),
            'production_countries':  json.dumps(d.get('production_countries') or []),
            'original_language':     d.get('original_language'),
            'poster_path':           d.get('poster_path'),
            'trailer_url':           d.get('trailer_url'),
            'belongs_to_collection': json.dumps(d['belongs_to_collection']) if d.get('belongs_to_collection') else None,
            'mpaa_rating':           d.get('mpaa_rating'),
            'vote_average':          d.get('vote_average') or 0,
            'vote_count':            d.get('vote_count') or 0,
            'popularity':            d.get('popularity') or 0,
            'budget_inferred':       1 if d.get('budget_inferred') else 0,
            'budget_source':         d.get('budget_source'),
            'last_tmdb_sync':        datetime.now(timezone.utc).isoformat(),
        }
    )
    return fetchone('SELECT * FROM films WHERE tmdb_id=?', (d['tmdb_id'],))


async def _get_or_fetch_watch_providers(film):
    raw = film.get('watch_providers_json')
    synced_at = film.get('watch_providers_synced_at')
    if raw and synced_at:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(synced_at).replace(tzinfo=timezone.utc)).total_seconds()
            if age < PROVIDERS_CACHE_TTL_S:
                return json.loads(raw)
        except Exception:
            pass
    providers = await get_watch_providers(film['tmdb_id'], film.get('market'))
    if providers:
        execute_write(
            'UPDATE films SET watch_providers_json=?, watch_providers_synced_at=? WHERE id=?',
            (json.dumps(providers), datetime.now(timezone.utc).isoformat(), film['id'])
        )
    return providers


async def _build_released_response(film):
    import asyncio
    released_data, watch_providers = await asyncio.gather(
        generate_released_film_data(film),
        _get_or_fetch_watch_providers(film),
        return_exceptions=True,
    )
    if isinstance(released_data, Exception):
        released_data = None
    if isinstance(watch_providers, Exception):
        watch_providers = None
    return {
        'film':            _format_film(film),
        'prediction':      released_data,
        'watch_providers': watch_providers,
        'mode':            'released',
        'used_as_comp':    True,
    }


# ── ROUTE 1: GET /api/films/search?q= ──────────────────────────────────

@router.get('/search')
async def search(q: str = Query(default='', alias='q')):
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail='Search query required')

    print(f'[ROUTE] search: "{q}"')

    db_films = fetchall(
        '''SELECT * FROM films
           WHERE title LIKE ? COLLATE NOCASE
             AND status IN ('upcoming','in_production','fresh_release')
           ORDER BY CASE WHEN lower(title)=lower(?) THEN 0 ELSE 1 END, popularity DESC
           LIMIT 5''',
        (f'%{q}%', q)
    )

    if db_films:
        film    = db_films[0]
        pred_row = _get_latest_prediction(film['id'])

        if pred_row:
            return {
                'film':               _format_film(film),
                'prediction':         _format_stored_prediction(pred_row),
                'sentiment_pending':  True,
                'methodology_version': pred_row['methodology_version'],
                'cache_hit':          True,
            }

        result = await generate_prediction(film)
        return {**result, 'cache_hit': False}

    print(f'[ROUTE] not in DB — querying TMDB for "{q}"')
    tmdb_results = await search_film(q)
    if not tmdb_results:
        raise HTTPException(status_code=404, detail='Film not found',
                            headers={'X-Suggestion': "Try including the release year, e.g. 'Batman 2027'"})

    film_data = await get_film_details(tmdb_results[0]['tmdb_id'])
    if not film_data:
        raise HTTPException(status_code=502, detail='Failed to fetch film details from TMDB')

    mode_result = determine_film_mode(film_data)
    print(f'[ROUTE] mode={mode_result["mode"]} predict={mode_result["predict"]} — {mode_result["reason"]}')

    film = _upsert_film(film_data, mode_result['mode'])

    if not mode_result['predict']:
        return await _build_released_response(film)

    result = await generate_prediction(film)
    return {**result, 'mode': mode_result['mode'], 'mode_reason': mode_result['reason'],
            'sentiment_pending': True, 'cache_hit': False}


# ── ROUTE 2: GET /api/films/upcoming?market= ───────────────────────────

@router.get('/upcoming')
def upcoming(market: str = Query(default=None)):
    if market:
        market = market.lower()
        if market not in VALID_MARKETS:
            raise HTTPException(status_code=400, detail=f'Invalid market. Valid: {sorted(VALID_MARKETS)}')

    placeholders = ','.join('?' * len(PREDICTABLE_STATUSES))
    params = list(PREDICTABLE_STATUSES)
    market_clause = ''
    if market:
        market_clause = 'AND f.market=?'
        params.append(market)

    films = fetchall(
        f'''SELECT f.*,
               p.confidence, p.final_score,
               p.global_ow_low, p.global_ow_mid, p.global_ow_high,
               p.generated_at AS pred_date, p.analyst_report
            FROM films f
            LEFT JOIN predictions p
                   ON p.film_id=f.id
                  AND p.id=(SELECT id FROM predictions WHERE film_id=f.id ORDER BY generated_at DESC LIMIT 1)
            WHERE f.status IN ({placeholders}) {market_clause}
            ORDER BY
              CASE p.confidence
                WHEN 'very_high' THEN 1 WHEN 'high' THEN 2
                WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5
              END,
              f.release_date ASC
            LIMIT 20''',
        params
    )

    return {
        'films':  [_format_film(f) for f in films],
        'market': market or 'all',
        'count':  len(films),
    }


# ── ROUTE 3: GET /api/films/:tmdb_id ───────────────────────────────────

@router.get('/{tmdb_id}')
async def get_film(tmdb_id: int):
    if tmdb_id <= 0:
        raise HTTPException(status_code=400, detail='tmdb_id must be a positive integer')

    film = fetchone('SELECT * FROM films WHERE tmdb_id=?', (tmdb_id,))
    if not film:
        raise HTTPException(status_code=404, detail='Film not found')

    if film['status'] == 'released' and (film.get('revenue') or 0) > 0:
        return await _build_released_response(film)

    pred_row = _get_latest_prediction(film['id'])
    return {'film': _format_film(film), 'prediction': _format_stored_prediction(pred_row)}


# ── ROUTE 4: GET /api/films/:tmdb_id/refresh ───────────────────────────

@router.get('/{tmdb_id}/refresh')
async def refresh_film(tmdb_id: int):
    if tmdb_id <= 0:
        raise HTTPException(status_code=400, detail='tmdb_id must be a positive integer')

    film = fetchone('SELECT * FROM films WHERE tmdb_id=?', (tmdb_id,))
    if not film:
        raise HTTPException(status_code=404, detail='Film not found')

    fresh = await get_film_details(tmdb_id)
    if fresh:
        film = _upsert_film(fresh)

    if film['status'] == 'released' and (film.get('revenue') or 0) > 0:
        execute_write('UPDATE films SET watch_providers_synced_at=NULL WHERE id=?', (film['id'],))
        film = fetchone('SELECT * FROM films WHERE id=?', (film['id'],))
        return {**(await _build_released_response(film)), 'refreshed': True}

    result = await generate_prediction(film)
    return {**result, 'refreshed': True}
