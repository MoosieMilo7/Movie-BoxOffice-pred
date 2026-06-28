/**
 * films.js — REST routes for the box office predictor.
 *
 * Route order matters: literal paths (/search, /upcoming) MUST come
 * before the parameterised /:tmdb_id to avoid Express swallowing them.
 */
import express from 'express';
import db from '../db/database.js';
import { searchFilm, getFilmDetails, getWatchProviders } from '../services/tmdb.js';
import { generatePrediction, generateReleasedFilmData }  from '../services/predictor.js';
import { determineFilmMode }                             from '../services/filmMode.js';

const router = express.Router();

const VALID_MARKETS = ['hollywood', 'bollywood', 'korean', 'japanese', 'european'];
const CURRENCY_SYMBOLS = { USD: '$', INR: '₹', KRW: '₩', JPY: '¥', EUR: '€' };

// Statuses that mean "we should predict and list as upcoming".
const PREDICTABLE_STATUSES = ['upcoming', 'in_production', 'fresh_release'];

// determineFilmMode is imported from services/filmMode.js

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeParse(v, fb) {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

function formatFilm(film) {
  return {
    ...film,
    genres:               safeParse(film.genres, []),
    cast_top5:            safeParse(film.cast_top5, []),
    director:             safeParse(film.director, null),
    production_companies: safeParse(film.production_companies, []),
    production_countries: safeParse(film.production_countries, []),
    belongs_to_collection:safeParse(film.belongs_to_collection, null),
    budget_inferred:      !!film.budget_inferred,
  };
}

function formatStoredPrediction(row) {
  if (!row) return null;
  return {
    generated_at:       row.generated_at,
    days_until_release: row.days_until_release,
    confidence:         row.confidence,
    confidence_reason:  row.confidence_reason,
    opening_weekend: {
      origin_market: {
        country:         row.origin_country,
        currency_code:   row.origin_currency,
        currency_symbol: CURRENCY_SYMBOLS[row.origin_currency] ?? row.origin_currency,
        low_usd:         row.origin_ow_low,
        mid_usd:         row.origin_ow_mid,
        high_usd:        row.origin_ow_high,
        low_local:       row.origin_ow_local_low,
        mid_local:       row.origin_ow_local_mid,
        high_local:      row.origin_ow_local_high,
      },
      global: {
        low_usd:  row.global_ow_low,
        mid_usd:  row.global_ow_mid,
        high_usd: row.global_ow_high,
      },
    },
    score_breakdown: {
      structural: row.structural_score,
      sentiment:  row.sentiment_score,
      momentum:   row.momentum_score,
      market:     row.market_score,
      comps:      row.comp_score,
      final:      row.final_score,
    },
    key_drivers:    safeParse(row.key_drivers, []),
    risk_factors:   safeParse(row.risk_factors, []),
    comp_films:     safeParse(row.comp_films_used, []),
    analyst_report: row.analyst_report ?? null,
    methodology_version: row.methodology_version,
  };
}

// Returns true if the film has at least one sentiment snapshot in DB.
function hasSentimentData(filmId) {
  return !!db.prepare('SELECT 1 FROM sentiment_snapshots WHERE film_id = ? LIMIT 1').get(filmId);
}

// Get the latest stored prediction for a film.
function getLatestPrediction(filmId) {
  return db.prepare(
    'SELECT * FROM predictions WHERE film_id = ? ORDER BY generated_at DESC LIMIT 1'
  ).get(filmId);
}

// Upsert a film row from getFilmDetails() response.
// statusOverride replaces TMDB's own status with the mode-derived value.
function upsertFilmFromDetails(d, statusOverride = null) {
  db.prepare(`
    INSERT INTO films (
      tmdb_id, title, overview, market, status, release_date,
      budget, revenue, runtime, genres, cast_top5, director,
      production_companies, production_countries, original_language,
      poster_path, trailer_url, belongs_to_collection, mpaa_rating,
      vote_average, vote_count, popularity,
      budget_inferred, budget_source, last_tmdb_sync
    ) VALUES (
      @tmdb_id, @title, @overview, @market, @status, @release_date,
      @budget, @revenue, @runtime, @genres, @cast_top5, @director,
      @production_companies, @production_countries, @original_language,
      @poster_path, @trailer_url, @belongs_to_collection, @mpaa_rating,
      @vote_average, @vote_count, @popularity,
      @budget_inferred, @budget_source, @last_tmdb_sync
    )
    ON CONFLICT(tmdb_id) DO UPDATE SET
      title                = excluded.title,
      overview             = excluded.overview,
      market               = excluded.market,
      status               = excluded.status,
      release_date         = excluded.release_date,
      budget               = excluded.budget,
      revenue              = excluded.revenue,
      runtime              = excluded.runtime,
      genres               = excluded.genres,
      cast_top5            = excluded.cast_top5,
      director             = excluded.director,
      production_companies = excluded.production_companies,
      production_countries = excluded.production_countries,
      original_language    = excluded.original_language,
      poster_path          = excluded.poster_path,
      trailer_url          = excluded.trailer_url,
      belongs_to_collection= excluded.belongs_to_collection,
      mpaa_rating          = excluded.mpaa_rating,
      vote_average         = excluded.vote_average,
      vote_count           = excluded.vote_count,
      popularity           = excluded.popularity,
      budget_inferred      = excluded.budget_inferred,
      budget_source        = excluded.budget_source,
      last_tmdb_sync       = excluded.last_tmdb_sync
  `).run({
    tmdb_id:               d.tmdb_id,
    title:                 d.title,
    overview:              d.overview              ?? null,
    market:                d.market               ?? 'hollywood',
    status:                statusOverride         ?? d.status ?? 'upcoming',
    release_date:          d.release_date         ?? null,
    budget:                d.budget               ?? 0,
    revenue:               d.revenue              ?? 0,
    runtime:               d.runtime              ?? null,
    genres:                JSON.stringify(d.genres              ?? []),
    cast_top5:             JSON.stringify(d.cast_top5            ?? []),
    director:              JSON.stringify(d.director             ?? null),
    production_companies:  JSON.stringify(d.production_companies ?? []),
    production_countries:  JSON.stringify(d.production_countries ?? []),
    original_language:     d.original_language    ?? null,
    poster_path:           d.poster_path          ?? null,
    trailer_url:           d.trailer_url          ?? null,
    belongs_to_collection: d.belongs_to_collection ? JSON.stringify(d.belongs_to_collection) : null,
    mpaa_rating:           d.mpaa_rating          ?? null,
    vote_average:          d.vote_average         ?? 0,
    vote_count:            d.vote_count           ?? 0,
    popularity:            d.popularity           ?? 0,
    budget_inferred:       d.budget_inferred      ? 1 : 0,
    budget_source:         d.budget_source        ?? null,
    last_tmdb_sync:        new Date().toISOString(),
  });
  return db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(d.tmdb_id);
}

/* ------------------------------------------------------------------ */
/* Released-film helpers: watch providers + performance data          */
/* ------------------------------------------------------------------ */

// Cache TTL for watch providers (7 days in ms)
const PROVIDERS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getOrFetchWatchProviders(film) {
  // Use cached data if fresh
  const raw = film.watch_providers_json;
  if (raw && film.watch_providers_synced_at) {
    const age = Date.now() - new Date(film.watch_providers_synced_at).getTime();
    if (age < PROVIDERS_CACHE_TTL_MS) {
      try { return JSON.parse(raw); } catch { /* fall through */ }
    }
  }
  // Fetch fresh from TMDB
  const providers = await getWatchProviders(film.tmdb_id, film.market);
  if (providers) {
    db.prepare(
      'UPDATE films SET watch_providers_json = ?, watch_providers_synced_at = ? WHERE id = ?'
    ).run(JSON.stringify(providers), new Date().toISOString(), film.id);
  }
  return providers;
}

async function buildReleasedResponse(film) {
  // Generate performance data (OW estimates + Claude analysis)
  const releasedData = await generateReleasedFilmData(film);

  // Fetch watch providers in parallel
  const watchProviders = await getOrFetchWatchProviders(film).catch(() => null);

  return {
    film:             formatFilm(film),
    prediction:       releasedData,
    watch_providers:  watchProviders,
    mode:             'released',
    used_as_comp:     true,
  };
}

/* ------------------------------------------------------------------ */
/* Background Apify scrape (fire-and-forget after response sent)     */
/* ------------------------------------------------------------------ */

async function triggerBackgroundScrape(film) {
  try {
    const { scrapeFilmSentiment } = await import('../services/apify.js');
    await scrapeFilmSentiment(film);
    await generatePrediction(film);
    db.prepare('UPDATE films SET last_apify_sync = ? WHERE id = ?')
      .run(new Date().toISOString(), film.id);
    console.log(`[BG SCRAPE] Complete for "${film.title}"`);
  } catch (err) {
    console.error(`[BG SCRAPE] Failed for "${film.title}":`, err.message);
  }
}

/* ================================================================== */
/* ROUTE 1 — GET /api/films/search?q=                                */
/* ================================================================== */

router.get('/search', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'Search query required' });

  console.log(`[ROUTE] search: "${q}"`);

  /* ── A: Local DB cache ──────────────────────────────────────────── */
  const dbFilms = db.prepare(`
    SELECT * FROM films
    WHERE title LIKE ? COLLATE NOCASE
      AND status IN ('upcoming', 'in_production', 'fresh_release')
    ORDER BY
      CASE WHEN lower(title) = lower(?) THEN 0 ELSE 1 END,
      popularity DESC
    LIMIT 5
  `).all(`%${q}%`, q);

  if (dbFilms.length > 0) {
    const film      = dbFilms[0];
    const predRow   = getLatestPrediction(film.id);
    const sentiment = hasSentimentData(film.id);

    // Check if background refresh is warranted.
    const lastSync    = film.last_apify_sync ? new Date(film.last_apify_sync) : null;
    const hoursSince  = lastSync ? (Date.now() - lastSync.getTime()) / 3_600_000 : Infinity;
    const daysOut     = predRow?.days_until_release ?? Infinity;
    const needsRefresh = !lastSync || (hoursSince > 6 && daysOut < 30);
    if (needsRefresh) {
      console.log(`[ROUTE] queuing background refresh for "${film.title}"`);
      setImmediate(() => triggerBackgroundScrape(film));
    }

    if (predRow) {
      return res.json({
        film:               formatFilm(film),
        prediction:         formatStoredPrediction(predRow),
        sentiment_pending:  !sentiment,
        methodology_version: predRow.methodology_version,
        cache_hit:          true,
      });
    }

    // Film in DB but no prediction yet — generate one.
    const result = await generatePrediction(film);
    return res.json({ ...result, cache_hit: false });
  }

  /* ── B: TMDB search ─────────────────────────────────────────────── */
  console.log(`[ROUTE] not in DB — querying TMDB for "${q}"`);
  const tmdbResults = await searchFilm(q);

  if (!tmdbResults || tmdbResults.length === 0) {
    return res.status(404).json({
      error:      'Film not found',
      suggestion: "Try including the release year, e.g. 'Batman 2027'",
    });
  }

  const filmData = await getFilmDetails(tmdbResults[0].tmdb_id);
  if (!filmData) {
    return res.status(502).json({ error: 'Failed to fetch film details from TMDB' });
  }

  const modeResult = determineFilmMode(filmData);
  console.log(`[ROUTE] mode=${modeResult.mode} predict=${modeResult.predict} — ${modeResult.reason}`);

  const film = upsertFilmFromDetails(filmData, modeResult.mode);

  if (!modeResult.predict) {
    return res.json(await buildReleasedResponse(film));
  }

  // Predictable (upcoming / fresh_release) — generate prediction + background scrape.
  const result = await generatePrediction(film);
  setImmediate(() => triggerBackgroundScrape(film));

  return res.json({ ...result, mode: modeResult.mode, mode_reason: modeResult.reason,
                    sentiment_pending: true, cache_hit: false });
});

/* ================================================================== */
/* ROUTE 4 — GET /api/films/upcoming?market=                         */
/* (registered before /:tmdb_id so "upcoming" isn't treated as an id)*/
/* ================================================================== */

router.get('/upcoming', (req, res) => {
  const market = req.query.market?.toLowerCase() ?? null;

  if (market && !VALID_MARKETS.includes(market)) {
    return res.status(400).json({
      error: 'Invalid market',
      valid: VALID_MARKETS,
    });
  }

  const films = db.prepare(`
    SELECT f.*,
           p.confidence,    p.final_score,
           p.global_ow_low, p.global_ow_mid, p.global_ow_high,
           p.generated_at   AS pred_date,
           p.analyst_report
    FROM films f
    LEFT JOIN predictions p
           ON p.film_id = f.id
          AND p.id = (
                SELECT id FROM predictions
                WHERE film_id = f.id
                ORDER BY generated_at DESC
                LIMIT 1
              )
    WHERE f.status IN (${PREDICTABLE_STATUSES.map(() => '?').join(',')})
      ${market ? 'AND f.market = ?' : ''}
    ORDER BY
      CASE p.confidence
        WHEN 'very_high' THEN 1 WHEN 'high' THEN 2
        WHEN 'medium'    THEN 3 WHEN 'low'  THEN 4
        ELSE 5
      END,
      f.release_date ASC
    LIMIT 20
  `).all(...PREDICTABLE_STATUSES, ...(market ? [market] : []));

  return res.json({
    films:  films.map(formatFilm),
    market: market ?? 'all',
    count:  films.length,
  });
});

/* ================================================================== */
/* ROUTE 2 — GET /api/films/:tmdb_id                                 */
/* ================================================================== */

router.get('/:tmdb_id', async (req, res) => {
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return res.status(400).json({ error: 'tmdb_id must be a positive integer' });
  }

  const film = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
  if (!film) return res.status(404).json({ error: 'Film not found' });

  // Released films get actual stats + watch providers, not a prediction
  if (film.status === 'released' && (film.revenue ?? 0) > 0) {
    return res.json(await buildReleasedResponse(film));
  }

  const predRow = getLatestPrediction(film.id);
  return res.json({
    film:       formatFilm(film),
    prediction: formatStoredPrediction(predRow),
  });
});

/* ================================================================== */
/* ROUTE 3 — GET /api/films/:tmdb_id/refresh                         */
/* ================================================================== */

router.get('/:tmdb_id/refresh', async (req, res) => {
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return res.status(400).json({ error: 'tmdb_id must be a positive integer' });
  }

  let film = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
  if (!film) return res.status(404).json({ error: 'Film not found' });

  // Re-sync TMDB metadata.
  const fresh = await getFilmDetails(tmdbId);
  if (fresh) film = upsertFilmFromDetails(fresh);

  // Released films: regenerate actual-stats view (clears provider cache too)
  if (film.status === 'released' && (film.revenue ?? 0) > 0) {
    // Invalidate cached providers so they re-fetch
    db.prepare('UPDATE films SET watch_providers_synced_at = NULL WHERE id = ?').run(film.id);
    return res.json({ ...(await buildReleasedResponse(film)), refreshed: true });
  }

  const result = await generatePrediction(film);
  return res.json({ ...result, refreshed: true });
});

export default router;
