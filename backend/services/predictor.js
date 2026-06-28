/**
 * predictor.js — Orchestrator
 *
 * Runs all 5 scoring dimensions, combines them into a final score,
 * derives the opening-weekend range, converts to local currency,
 * calls Claude for a 3-sentence analyst report, and persists to DB.
 *
 * Every scorer is independently try/caught — one failure never aborts.
 */
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import db from '../db/database.js';
import { computeStructuralScore } from './scoring/structural.js';
import { computeSentimentScore }  from './scoring/sentiment.js';
import { computeMomentumScore }   from './scoring/momentum.js';
import { computeMarketScore }     from './scoring/market.js';
import { computeCompScore }       from './scoring/comps.js';
import { computeConfidence }      from './scoring/confidence.js';

dotenv.config();

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const METHODOLOGY_VERSION  = 'v2.0';
const CLAUDE_MODEL         = 'claude-sonnet-4-6';
const COMP_AVG_FINAL_SCORE = 0.55;

const ORIGIN_SPLITS = {
  hollywood: 0.55, bollywood: 0.72, korean: 0.58,
  japanese:  0.78, european:  0.45,
};

const CURRENCY_MAP = {
  hollywood: { code: 'USD', symbol: '$',  fallback_rate: 1.00   },
  bollywood: { code: 'INR', symbol: '₹',  fallback_rate: 84.5  },
  korean:    { code: 'KRW', symbol: '₩',  fallback_rate: 1360  },
  japanese:  { code: 'JPY', symbol: '¥',  fallback_rate: 157   },
  european:  { code: 'EUR', symbol: '€',  fallback_rate: 0.93  },
};

const ORIGIN_COUNTRY_MAP = {
  hollywood: 'United States', bollywood: 'India',
  korean: 'South Korea',      japanese:  'Japan',
};

const EU_COUNTRY_NAMES = {
  GB: 'United Kingdom', FR: 'France',  ES: 'Spain',
  IT: 'Italy',          DE: 'Germany', SE: 'Sweden',
  DK: 'Denmark',        NO: 'Norway',  NL: 'Netherlands',
};

/* ------------------------------------------------------------------ */
/* Score fallbacks                                                    */
/* ------------------------------------------------------------------ */

const FALLBACK = {
  structural: { score: 0.40, components: { budget: {}, franchise: {}, genre: {}, talent: {}, mpaa: {} } },
  sentiment:  { score: 0.35, data_available: false, label: null, one_line: null },
  momentum:   { score: 0.30, components: { mention_velocity: {}, trailer_velocity: {}, volume: {} }, data_available: false },
  market:     { score: 0.50, components: { season: { score: 0.50, label: 'unknown' }, competition: { score: 1.0, major_competitor_count: 0, competitor_titles: [] } } },
  comps:      { score: 0.30, weighted_ow_global_usd: null, comps_found: 0, comps_used: [], data_available: false },
  confidence: { level: 'low', range_multiplier: 0.60, days_until_release: null, reason: 'Scoring failed' },
};

/* ------------------------------------------------------------------ */
/* Exchange rate (24h cache)                                          */
/* ------------------------------------------------------------------ */

let _rateCache   = null;
let _rateExpires = 0;

async function getExchangeRate(currencyCode) {
  if (currencyCode === 'USD') return 1.0;

  if (!_rateCache || Date.now() > _rateExpires) {
    try {
      const key = process.env.EXCHANGE_RATE_API_KEY;
      if (key) {
        const res = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`);
        if (res.ok) {
          const d = await res.json();
          if (d.result === 'success') {
            _rateCache   = d.conversion_rates;
            _rateExpires = Date.now() + 24 * 60 * 60 * 1000;
          }
        }
      }
    } catch { /* use fallback */ }
  }

  const fallback = Object.values(CURRENCY_MAP)
    .find((c) => c.code === currencyCode)?.fallback_rate ?? 1.0;
  return _rateCache?.[currencyCode] ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function r2(n) { return Math.round(n * 100)    / 100;    }
function r4(n) { return Math.round(n * 10_000) / 10_000; }

function safeParse(v, fb) {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

function getBudgetMultiplier(budget) {
  if (budget >= 150_000_000) return 0.35;
  if (budget >= 80_000_000)  return 0.26;
  if (budget >= 25_000_000)  return 0.18;
  if (budget >= 5_000_000)   return 0.10;
  return 0.05;
}

function getOriginCountry(film) {
  const mkt = film.market || 'hollywood';
  if (mkt !== 'european') return ORIGIN_COUNTRY_MAP[mkt] ?? 'United States';
  const countries = safeParse(film.production_countries, []);
  for (const code of Object.keys(EU_COUNTRY_NAMES)) {
    if (countries.some((c) => c.iso_3166_1 === code)) return EU_COUNTRY_NAMES[code];
  }
  return 'Europe';
}

/* ------------------------------------------------------------------ */
/* Key drivers                                                        */
/* ------------------------------------------------------------------ */

function buildKeyDrivers(structural, sentiment, momentum, market, comps) {
  const drivers = [];
  const budget      = structural.components?.budget     ?? {};
  const franchise   = structural.components?.franchise  ?? {};
  const talent      = structural.components?.talent     ?? {};
  const mentionVel  = momentum.components?.mention_velocity ?? {};
  const trailerVel  = momentum.components?.trailer_velocity ?? {};
  const season      = market.components?.season         ?? {};
  const competition = market.components?.competition    ?? {};

  if (budget.tier === 'tentpole')
    drivers.push('Tentpole budget signals wide release');

  if ((franchise.score ?? 0) >= 0.80)
    drivers.push('Major franchise IP with proven audience');
  else if ((franchise.score ?? 0) >= 0.65)
    drivers.push('Franchise IP reduces audience uncertainty');

  if ((sentiment.score ?? 0) >= 0.75)
    drivers.push('High pre-release social sentiment');
  else if ((sentiment.score ?? 0) >= 0.55)
    drivers.push('Positive audience sentiment building');

  if (mentionVel.velocity_pct != null && mentionVel.velocity_pct >= 30)
    drivers.push('Accelerating social buzz');

  if (trailerVel.velocity_pct != null && trailerVel.velocity_pct >= 50)
    drivers.push('Viral trailer performance');

  if ((season.score ?? 0) >= 0.85)
    drivers.push('Premium release window (summer/holiday)');

  if (competition.score === 1.00)
    drivers.push('Clear market leader — no major competition');

  if ((talent.director_score ?? 0) >= 0.65)
    drivers.push('Director has strong box office track record');

  if ((comps.comps_found ?? 0) >= 3) {
    const avg = comps.weighted_ow_global_usd?.toFixed(0) ?? '?';
    drivers.push(`Strong comp anchor from similar films: Similar films averaged $${avg}m global OW`);
  }

  return drivers.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Risk factors                                                       */
/* ------------------------------------------------------------------ */

function buildRiskFactors(film, structural, sentiment, momentum, market, comps) {
  const risks = [];
  const budget      = structural.components?.budget    ?? {};
  const franchise   = structural.components?.franchise ?? {};
  const genre       = structural.components?.genre     ?? {};
  const mentionVel  = momentum.components?.mention_velocity ?? {};
  const competition = market.components?.competition   ?? {};

  if (!sentiment.data_available)
    risks.push('No social signal yet — prediction based on structural factors only');

  if (film.budget_inferred && !(film.budget > 0))
    risks.push('Budget unconfirmed — using franchise inference');
  else if (!(film.budget > 0) && !film.budget_inferred)
    risks.push('Budget unknown — significant uncertainty');

  if ((franchise.score ?? 1) < 0.40 && !['tentpole', 'major'].includes(budget.tier ?? ''))
    risks.push('Original IP without franchise safety net');

  if (mentionVel.velocity_pct != null && mentionVel.velocity_pct < -10)
    risks.push('Buzz declining — negative momentum signal');

  if ((competition.score ?? 1) <= 0.50) {
    const titles = (competition.competitor_titles ?? []).slice(0, 2).join(', ');
    risks.push(`Competitive release window${titles ? ` (${titles})` : ''}`);
  }

  const EXEMPT_GENRES = ['Horror', 'Crime', 'Thriller'];
  if (film.mpaa_rating === 'R' && !EXEMPT_GENRES.includes(genre.primary_genre ?? ''))
    risks.push('Restricted rating limits audience ceiling');

  if ((comps.comps_found ?? 0) < 3)
    risks.push('Limited comp data — fewer than 3 similar films');

  return risks.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Claude analyst report                                              */
/* ------------------------------------------------------------------ */

let _anthropic = null;

async function generateAnalystReport(film, ow, scores, confidence, keyDrivers, riskFactors, comps) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const originCountry = getOriginCountry(film);
    const compsList = comps.comps_used?.length
      ? comps.comps_used.map((c) => `${c.title}: $${c.actual_ow_global_usd}M global OW`).join('\n')
      : 'No comparable films found';

    const userMsg = `Generate analyst report for:

Title: ${film.title}
Release: ${film.release_date || 'TBD'} (${confidence.days_until_release ?? 'unknown'} days out)
Market: ${film.market}
Status: ${film.status}

PROJECTION:
Global OW: $${ow.global_ow_low}M – $${ow.global_ow_high}M
Origin (${originCountry}): $${ow.origin_ow_low}M – $${ow.origin_ow_high}M
Confidence: ${confidence.level}

SCORE BREAKDOWN:
Structural: ${scores.structural}/1.0
Sentiment: ${scores.sentiment}/1.0 (${comps.comps_used?.length ? 'data' : 'no data'})
Momentum: ${scores.momentum}/1.0
Market: ${scores.market}/1.0
Comp anchor: ${scores.comps}/1.0

COMP FILMS USED:
${compsList}

KEY DRIVERS: ${keyDrivers.join(', ')}
RISK FACTORS: ${riskFactors.join(', ')}
CONFIDENCE REASON: ${confidence.reason}`;

    const resp = await _anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 250,
      temperature: 0,
      system: `You are a senior film acquisition analyst writing brief reports for streaming rights buyers.
Write exactly 3 sentences. No more, no less.
Sentence 1: State the film's current market position and the single strongest signal.
Sentence 2: Explain what is driving the projection using the specific numbers provided.
Sentence 3: State the primary risk or uncertainty that could move the number in either direction.
Rules: Use specific numbers from the data. No filler phrases like 'it is worth noting'. Do not invent any information not provided. Do not exceed 3 sentences.`,
      messages: [{ role: 'user', content: userMsg }],
    });

    return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (err) {
    console.error('[PREDICTOR] Claude API failed, skipping report:', err.message);
    return null;
  }
}

/* ================================================================== */
/* generatePrediction(film)                                           */
/* ================================================================== */

export async function generatePrediction(film) {
  console.log(`\n[PREDICTOR] ── Starting prediction for "${film.title}" (tmdb_id=${film.tmdb_id}) ──`);

  /* ── Step 1: Run all scorers ────────────────────────────────────── */
  let structural = FALLBACK.structural;
  try {
    structural = computeStructuralScore(film);
    console.log(`[PREDICTOR] structural:  ${structural.score}`);
  } catch (e) { console.error('[PREDICTOR] structural failed:', e.message); }

  let sentiment = FALLBACK.sentiment;
  try {
    sentiment = computeSentimentScore(film.id);
    console.log(`[PREDICTOR] sentiment:   ${sentiment.score} (${sentiment.data_available ? sentiment.label || 'data' : 'no data'})`);
  } catch (e) { console.error('[PREDICTOR] sentiment failed:', e.message); }

  let momentum = FALLBACK.momentum;
  try {
    momentum = computeMomentumScore(film.id);
    console.log(`[PREDICTOR] momentum:    ${momentum.score} (data=${momentum.data_available})`);
  } catch (e) { console.error('[PREDICTOR] momentum failed:', e.message); }

  let market = FALLBACK.market;
  try {
    market = computeMarketScore(film);
    console.log(`[PREDICTOR] market:      ${market.score} (season=${market.components.season.label}, competitors=${market.components.competition.major_competitor_count})`);
  } catch (e) { console.error('[PREDICTOR] market failed:', e.message); }

  let comps = FALLBACK.comps;
  try {
    comps = await computeCompScore(film);
    console.log(`[PREDICTOR] comps:       ${comps.score} (${comps.comps_found} comps, global_ow=$${comps.weighted_ow_global_usd}M)`);
  } catch (e) { console.error('[PREDICTOR] comps failed:', e.message); }

  let confidence = FALLBACK.confidence;
  try {
    confidence = computeConfidence(film, sentiment, comps);
    console.log(`[PREDICTOR] confidence:  ${confidence.level} (range ±${confidence.range_multiplier * 100}%, ${confidence.days_until_release} days out)`);
  } catch (e) { console.error('[PREDICTOR] confidence failed:', e.message); }

  /* ── Step 2: Final score ────────────────────────────────────────── */
  const final_score = r4(
    structural.score * 0.25 +
    sentiment.score  * 0.30 +
    momentum.score   * 0.20 +
    market.score     * 0.10 +
    comps.score      * 0.15
  );
  console.log(`[PREDICTOR] final_score: ${final_score}`);

  /* ── Step 3: OW estimate ─────────────────────────────────────────── */
  let global_ow_mid;

  if (comps.data_available && (comps.weighted_ow_global_usd ?? 0) > 0) {
    const scale = Math.max(0.30, Math.min(final_score / COMP_AVG_FINAL_SCORE, 2.50));
    global_ow_mid = r2(comps.weighted_ow_global_usd * scale);
    console.log(`[PREDICTOR] comp anchor: $${comps.weighted_ow_global_usd}M × scale ${scale.toFixed(3)} = $${global_ow_mid}M`);
  } else {
    const budget = (film.budget > 0) ? film.budget : 150_000_000;
    const budgetMult   = getBudgetMultiplier(budget);
    const sentimentMult = 0.60 + (sentiment.score * 0.80);
    global_ow_mid = r2((budget * budgetMult * sentimentMult) / 1_000_000);
    console.log(`[PREDICTOR] budget anchor fallback used → $${global_ow_mid}M`);
  }

  const originSplit  = ORIGIN_SPLITS[film.market ?? 'hollywood'] ?? 0.55;
  const origin_ow_mid = r2(global_ow_mid * originSplit);
  const rangeMult     = confidence.range_multiplier;

  const ow = {
    global_ow_low:   r2(global_ow_mid  * (1 - rangeMult)),
    global_ow_mid,
    global_ow_high:  r2(global_ow_mid  * (1 + rangeMult)),
    origin_ow_low:   r2(origin_ow_mid  * (1 - rangeMult)),
    origin_ow_mid,
    origin_ow_high:  r2(origin_ow_mid  * (1 + rangeMult)),
  };

  /* ── Step 4: Local currency ─────────────────────────────────────── */
  const mkt     = film.market ?? 'hollywood';
  const curInfo = CURRENCY_MAP[mkt] ?? CURRENCY_MAP.hollywood;
  const rate    = await getExchangeRate(curInfo.code);

  const toLocal = (usdM) => r2(usdM * rate * 1_000_000);
  const origin_ow_local_low  = toLocal(ow.origin_ow_low);
  const origin_ow_local_mid  = toLocal(ow.origin_ow_mid);
  const origin_ow_local_high = toLocal(ow.origin_ow_high);

  /* ── Step 5: Origin country ─────────────────────────────────────── */
  const origin_country = getOriginCountry(film);

  /* ── Step 6: Drivers & risks ────────────────────────────────────── */
  const key_drivers  = buildKeyDrivers(structural, sentiment, momentum, market, comps);
  const risk_factors = buildRiskFactors(film, structural, sentiment, momentum, market, comps);

  /* ── Step 7: Claude report ──────────────────────────────────────── */
  const scores = {
    structural: structural.score, sentiment: sentiment.score,
    momentum:   momentum.score,   market:    market.score,
    comps:      comps.score,
  };
  const analyst_report = await generateAnalystReport(film, ow, scores, confidence, key_drivers, risk_factors, comps);

  /* ── Step 8: Store prediction ───────────────────────────────────── */
  const generated_at = new Date().toISOString();
  const comp_films_used = comps.comps_used?.map((c) => ({
    title: c.title, actual_ow_global_usd: c.actual_ow_global_usd,
  })) ?? [];

  const info = db.prepare(`
    INSERT INTO predictions (
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
      @film_id, @generated_at, @days_until_release,
      @structural_score, @sentiment_score, @momentum_score, @market_score, @comp_score, @final_score,
      @origin_ow_low, @origin_ow_mid, @origin_ow_high,
      @origin_country, @origin_currency,
      @origin_ow_local_low, @origin_ow_local_mid, @origin_ow_local_high,
      @global_ow_low, @global_ow_mid, @global_ow_high,
      @confidence, @confidence_reason,
      @key_drivers, @risk_factors, @comp_films_used,
      @analyst_report, @methodology_version
    )
  `).run({
    film_id:              film.id,
    generated_at,
    days_until_release:   confidence.days_until_release,
    structural_score:     structural.score,
    sentiment_score:      sentiment.score,
    momentum_score:       momentum.score,
    market_score:         market.score,
    comp_score:           comps.score,
    final_score,
    origin_ow_low:        ow.origin_ow_low,
    origin_ow_mid:        ow.origin_ow_mid,
    origin_ow_high:       ow.origin_ow_high,
    origin_country,
    origin_currency:      curInfo.code,
    origin_ow_local_low,
    origin_ow_local_mid,
    origin_ow_local_high,
    global_ow_low:        ow.global_ow_low,
    global_ow_mid:        ow.global_ow_mid,
    global_ow_high:       ow.global_ow_high,
    confidence:           confidence.level,
    confidence_reason:    confidence.reason,
    key_drivers:          JSON.stringify(key_drivers),
    risk_factors:         JSON.stringify(risk_factors),
    comp_films_used:      JSON.stringify(comp_films_used),
    analyst_report:       analyst_report ?? null,
    methodology_version:  METHODOLOGY_VERSION,
  });

  console.log(`[PREDICTOR] Prediction stored, id: ${info.lastInsertRowid}`);

  /* ── Return ─────────────────────────────────────────────────────── */
  return {
    film: {
      tmdb_id:      film.tmdb_id,
      title:        film.title,
      market:       film.market,
      status:       film.status,
      release_date: film.release_date,
      poster_path:  film.poster_path,
    },
    prediction: {
      generated_at,
      days_until_release:  confidence.days_until_release,
      confidence:          confidence.level,
      confidence_reason:   confidence.reason,
      opening_weekend: {
        origin_market: {
          country:         origin_country,
          currency_code:   curInfo.code,
          currency_symbol: curInfo.symbol,
          low_usd:         ow.origin_ow_low,
          mid_usd:         ow.origin_ow_mid,
          high_usd:        ow.origin_ow_high,
          low_local:       origin_ow_local_low,
          mid_local:       origin_ow_local_mid,
          high_local:      origin_ow_local_high,
        },
        global: {
          low_usd: ow.global_ow_low,
          mid_usd: ow.global_ow_mid,
          high_usd: ow.global_ow_high,
        },
      },
      score_breakdown: {
        structural: structural.score,
        sentiment:  sentiment.score,
        momentum:   momentum.score,
        market:     market.score,
        comps:      comps.score,
        final:      final_score,
      },
      key_drivers,
      risk_factors,
      comp_films:     comp_films_used,
      analyst_report: analyst_report ?? null,
    },
    sentiment_pending:    !sentiment.data_available,
    methodology_version:  METHODOLOGY_VERSION,
  };
}

/* ================================================================== */
/* generateReleasedFilmData(film)                                      */
/* ================================================================== */

const RELEASED_OW_RATES = {
  hollywood: { global_rate: 0.22, domestic_pct: 0.40, domestic_ow_rate: 0.18 },
  bollywood: { global_rate: 0.25, domestic_pct: 0.65, domestic_ow_rate: 0.40 },
  korean:    { global_rate: 0.28, domestic_pct: 0.40, domestic_ow_rate: 0.35 },
  japanese:  { global_rate: 0.30, domestic_pct: 0.85, domestic_ow_rate: 0.45 },
  european:  { global_rate: 0.15, domestic_pct: 0.30, domestic_ow_rate: 0.12 },
};

async function generatePerformanceAnalysis(film, owGlobalM, owOriginM) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const revenue = film.revenue || 0;
    const budget  = film.budget  || 0;
    const roi     = budget > 0 ? (((revenue - budget) / budget) * 100).toFixed(0) : null;
    const year    = film.release_date ? new Date(film.release_date).getFullYear() : 'unknown';
    const resp = await _anthropic.messages.create({
      model: CLAUDE_MODEL, max_tokens: 120, temperature: 0,
      system: 'You are a film industry box office analyst. Write concise, data-driven performance assessments. Use specific numbers. No filler.',
      messages: [{ role: 'user', content:
`Assess: ${film.title} (${year}) | Market: ${film.market || 'hollywood'} | Budget: ${budget > 0 ? '$' + r2(budget / 1_000_000) + 'M' : 'unknown'} | WW Revenue: $${r2(revenue / 1_000_000)}M | Est. OW Global: ~$${owGlobalM.toFixed(0)}M | Est. OW Domestic: ~$${owOriginM.toFixed(0)}M${roi !== null ? ' | ROI: ' + roi + '%' : ''}
Write exactly 2 sentences: (1) Hit/miss/moderate with specific numbers. (2) Key driver or factor. Max 55 words total.` }],
    });
    return resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() || null;
  } catch (err) {
    console.error('[PREDICTOR] Performance analysis failed:', err.message);
    return null;
  }
}

export async function generateReleasedFilmData(film) {
  const revenue = film.revenue || 0;
  const budget  = film.budget  || 0;
  const market  = film.market?.toLowerCase() || 'hollywood';
  const rates   = RELEASED_OW_RATES[market] || RELEASED_OW_RATES.hollywood;
  const curInfo = CURRENCY_MAP[market]       || CURRENCY_MAP.hollywood;

  const ow_global_mid  = r2((revenue / 1_000_000) * rates.global_rate);
  const ow_origin_mid  = r2((revenue / 1_000_000) * rates.domestic_pct * rates.domestic_ow_rate);
  const ow_global_low  = r2(ow_global_mid * 0.82);
  const ow_global_high = r2(ow_global_mid * 1.18);
  const ow_origin_low  = r2(ow_origin_mid * 0.82);
  const ow_origin_high = r2(ow_origin_mid * 1.18);

  const roi = budget > 0 ? r2(((revenue - budget) / budget) * 100) : null;
  let performance_tier = 'moderate';
  if (budget > 0) {
    if (revenue >= budget * 2.5)  performance_tier = 'hit';
    else if (revenue >= budget * 1.5) performance_tier = 'moderate_hit';
    else if (revenue < budget * 1.0)  performance_tier = 'miss';
  }

  console.log(`[PREDICTOR][RELEASED] Generating performance analysis for "${film.title}"`);
  const analysis = await generatePerformanceAnalysis(film, ow_global_mid, ow_origin_mid);
  const origin_country = getOriginCountry(film);

  return {
    mode: 'released',
    actual_worldwide_gross: revenue,
    actual_worldwide_gross_millions: r2(revenue / 1_000_000),
    budget_millions: budget > 0 ? r2(budget / 1_000_000) : null,
    roi_percent: roi,
    performance_tier,
    analyst_report: analysis,
    opening_weekend: {
      origin_market: {
        country: origin_country, currency_code: curInfo.code, currency_symbol: curInfo.symbol,
        low_usd: ow_origin_low, mid_usd: ow_origin_mid, high_usd: ow_origin_high, estimated: true,
      },
      global: {
        low_usd: ow_global_low, mid_usd: ow_global_mid, high_usd: ow_global_high, estimated: true,
      },
    },
    note: 'Opening weekend figures are estimates derived from total worldwide revenue using historical market performance patterns.',
  };
}
