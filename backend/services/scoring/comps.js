/**
 * comps.js — Comp-anchored OW prediction.
 *
 * Finds real similar films, derives their actual opening-weekend figures,
 * and weights them by similarity to anchor the prediction.
 *
 * Two-pass enrichment strategy:
 *   Pass 1: score candidates on genre + market + recency (no API calls)
 *   Pass 2: enrich top-10 with getFilmDetails (revenue + budget + franchise)
 *           then re-score with full data, take best 5
 */
import db from '../../db/database.js';
import { getFilmDetails, getReleasedFilmsForComps } from '../tmdb.js';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const GENRE_ID_MAP = {
  'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
  'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
  'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
  'Mystery': 9648, 'Romance': 10749, 'Science Fiction': 878,
  'Thriller': 53, 'War': 10752, 'Western': 37,
};

// Origin-market splits: domestic fraction of WW revenue × domestic OW rate
const MARKET_OW_SPLITS = {
  hollywood: { domestic_pct: 0.40, ow_rate: 0.18 },
  bollywood: { domestic_pct: 0.65, ow_rate: 0.40 },
  korean:    { domestic_pct: 0.40, ow_rate: 0.35 },
  japanese:  { domestic_pct: 0.85, ow_rate: 0.45 },
  european:  { domestic_pct: 0.30, ow_rate: 0.12 },
};

const GLOBAL_OW_RATE     = 0.31;   // OW as % of worldwide total
const COMP_SCORE_CEILING = 300;    // $300M OW → comp_score 1.0 (in millions)
const MAX_ENRICH         = 10;     // API enrichment budget per call
const TOP_N              = 5;      // final comp set size
const WEIGHT_COMPS       = 3;      // use top-N for weighted average

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function safeParse(v, fb) {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

function r2(n) { return Math.round(n * 100) / 100; }
function r4(n) { return Math.round(n * 10_000) / 10_000; }

function getBudgetTier(budget) {
  if (!budget || budget <= 0) return 'unknown';
  if (budget >= 150_000_000) return 'tentpole';
  if (budget >= 80_000_000)  return 'major';
  if (budget >= 25_000_000)  return 'mid';
  if (budget >= 5_000_000)   return 'indie';
  return 'micro';
}

/* ------------------------------------------------------------------ */
/* Candidate normalisation                                            */
/* ------------------------------------------------------------------ */

function normaliseDbRow(row) {
  const genreNames  = safeParse(row.genres, []);
  const collection  = safeParse(row.belongs_to_collection, null);
  return {
    db_id:                row.id,
    tmdb_id:              row.tmdb_id,
    title:                row.title,
    release_date:         row.release_date ?? null,
    revenue:              row.revenue       ?? 0,
    budget:               row.budget        ?? 0,
    budget_inferred:      !!row.budget_inferred,
    genre_ids:            genreNames.map((g) => GENRE_ID_MAP[g]).filter(Boolean),
    genre_names:          genreNames,
    market:               row.market        ?? 'hollywood',
    belongs_to_collection: collection,
    mpaa_rating:          row.mpaa_rating   ?? null,
    source:               'db',
  };
}

function normaliseDiscover(result, market) {
  return {
    db_id:                null,
    tmdb_id:              result.tmdb_id,
    title:                result.title,
    release_date:         result.release_date ?? null,
    revenue:              0,
    budget:               0,
    budget_inferred:      false,
    genre_ids:            result.genre_ids   ?? [],
    genre_names:          [],
    market,
    belongs_to_collection: null,
    mpaa_rating:          null,
    source:               'discover',
  };
}

/* ------------------------------------------------------------------ */
/* Revenue enrichment — upsert comp film into films table             */
/* ------------------------------------------------------------------ */

async function enrichCandidate(candidate) {
  // Already have revenue from DB? Use as-is.
  if (candidate.source === 'db' && candidate.revenue > 0) return candidate;

  // Check DB first (may have been upserted by a previous run).
  const existing = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(candidate.tmdb_id);
  if (existing && (existing.revenue ?? 0) > 0) return normaliseDbRow(existing);

  // Fetch full details from TMDB.
  const d = await getFilmDetails(candidate.tmdb_id);
  if (!d) return null;
  if (!d.revenue || d.revenue === 0) return null; // no revenue → skip

  const genreNames = d.genres ?? [];
  const collection = d.belongs_to_collection;

  db.prepare(`
    INSERT INTO films (
      tmdb_id, title, overview, market, status, release_date,
      budget, revenue, runtime, genres, cast_top5, director,
      production_companies, production_countries, original_language,
      poster_path, trailer_url, belongs_to_collection, mpaa_rating,
      vote_average, vote_count, popularity, last_tmdb_sync
    ) VALUES (
      @tmdb_id, @title, @overview, @market, @status, @release_date,
      @budget, @revenue, @runtime, @genres, @cast_top5, @director,
      @production_companies, @production_countries, @original_language,
      @poster_path, @trailer_url, @belongs_to_collection, @mpaa_rating,
      @vote_average, @vote_count, @popularity, @last_tmdb_sync
    )
    ON CONFLICT(tmdb_id) DO UPDATE SET
      title                = excluded.title,
      market               = excluded.market,
      status               = excluded.status,
      budget               = excluded.budget,
      revenue              = excluded.revenue,
      genres               = excluded.genres,
      belongs_to_collection= excluded.belongs_to_collection,
      mpaa_rating          = excluded.mpaa_rating,
      vote_average         = excluded.vote_average,
      vote_count           = excluded.vote_count,
      popularity           = excluded.popularity,
      last_tmdb_sync       = excluded.last_tmdb_sync
  `).run({
    tmdb_id:               d.tmdb_id,
    title:                 d.title,
    overview:              d.overview ?? null,
    market:                d.market ?? candidate.market,
    status:                d.status ?? 'released',
    release_date:          d.release_date ?? null,
    budget:                d.budget  ?? 0,
    revenue:               d.revenue ?? 0,
    runtime:               d.runtime ?? null,
    genres:                JSON.stringify(genreNames),
    cast_top5:             JSON.stringify(d.cast_top5 ?? []),
    director:              JSON.stringify(d.director  ?? null),
    production_companies:  JSON.stringify(d.production_companies ?? []),
    production_countries:  JSON.stringify(d.production_countries ?? []),
    original_language:     d.original_language ?? null,
    poster_path:           d.poster_path ?? null,
    trailer_url:           d.trailer_url ?? null,
    belongs_to_collection: collection ? JSON.stringify(collection) : null,
    mpaa_rating:           d.mpaa_rating ?? null,
    vote_average:          d.vote_average ?? 0,
    vote_count:            d.vote_count   ?? 0,
    popularity:            d.popularity   ?? 0,
    last_tmdb_sync:        new Date().toISOString(),
  });

  const row = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(d.tmdb_id);
  return row ? normaliseDbRow(row) : null;
}

/* ------------------------------------------------------------------ */
/* Similarity scoring                                                 */
/* ------------------------------------------------------------------ */

// Lightweight first-pass: genre + market + recency only (no API needed).
function prelimScore(film, candidate) {
  const filmGenreNames = safeParse(film.genres, []);
  const filmPrimaryId  = filmGenreNames.map((g) => GENRE_ID_MAP[g]).find(Boolean);
  let pts = 0;
  if (filmPrimaryId && candidate.genre_ids[0] === filmPrimaryId) pts += 3;
  if ((film.market ?? 'hollywood') === candidate.market)          pts += 3;
  const yr = candidate.release_date ? parseInt(candidate.release_date.slice(0, 4), 10) : null;
  if (yr) {
    const ago = new Date().getFullYear() - yr;
    if (ago <= 2) pts += 2;
    else if (ago <= 5) pts += 1;
  }
  return pts;
}

// Full similarity after enrichment (13-point system).
function fullScore(film, candidate) {
  const filmGenreNames  = safeParse(film.genres, []);
  const filmPrimaryId   = filmGenreNames.map((g) => GENRE_ID_MAP[g]).find(Boolean);
  const filmCollection  = safeParse(film.belongs_to_collection, null);
  const filmHasColl     = !!filmCollection;
  const filmBudget      = film.budget_inferred ? 150_000_000 : (film.budget ?? 0);
  const filmTier        = getBudgetTier(filmBudget);
  const filmMpaa        = film.mpaa_rating ?? null;

  const candBudget      = candidate.budget_inferred ? 150_000_000 : (candidate.budget ?? 0);
  const candTier        = getBudgetTier(candBudget);
  const candHasColl     = !!candidate.belongs_to_collection;
  const candMpaa        = candidate.mpaa_rating ?? null;
  const candPrimaryId   = candidate.genre_ids[0];

  let pts = 0;
  const reasons = [];

  if (filmPrimaryId && candPrimaryId && filmPrimaryId === candPrimaryId) {
    pts += 3;
    reasons.push(`Same genre (${filmGenreNames[0] ?? 'Action'})`);
  }
  if ((film.market ?? 'hollywood') === candidate.market) {
    pts += 3;
    const label = (candidate.market.charAt(0).toUpperCase() + candidate.market.slice(1));
    reasons.push(`Same market (${label})`);
  }
  if (filmTier === candTier) {
    pts += 2;
    reasons.push(`Same budget tier (${filmTier})`);
  }
  if (filmHasColl === candHasColl) {
    pts += 2;
    reasons.push('Same franchise structure');
  }
  if (filmMpaa && candMpaa && filmMpaa === candMpaa) {
    pts += 1;
    reasons.push(`Same MPAA rating (${filmMpaa})`);
  }
  const yr = candidate.release_date ? parseInt(candidate.release_date.slice(0, 4), 10) : null;
  if (yr) {
    const ago = new Date().getFullYear() - yr;
    if (ago <= 2) { pts += 2; reasons.push(`Recent release (${yr})`); }
    else if (ago <= 5) { pts += 1; reasons.push(`Recent release (${yr})`); }
  }

  return { similarity_score: r4(pts / 13), match_reasons: reasons };
}

/* ------------------------------------------------------------------ */
/* OW estimate from comp revenue                                      */
/* ------------------------------------------------------------------ */

function compOW(revenue, market) {
  const sp = MARKET_OW_SPLITS[market] ?? MARKET_OW_SPLITS.hollywood;
  return {
    ow_origin: r2((revenue * sp.domestic_pct * sp.ow_rate) / 1_000_000),
    ow_global: r2((revenue * GLOBAL_OW_RATE) / 1_000_000),
  };
}

/* ------------------------------------------------------------------ */
/* Cache path                                                         */
/* ------------------------------------------------------------------ */

function calcFromCached(rows) {
  const top3 = rows.slice(0, WEIGHT_COMPS);
  const tw   = top3.reduce((s, r) => s + r.similarity_score, 0);
  const wOri = top3.reduce((s, r) => s + r.comp_actual_ow_origin * r.similarity_score, 0) / tw;
  const wGlo = top3.reduce((s, r) => s + r.comp_actual_ow_global * r.similarity_score, 0) / tw;
  return {
    score:                  r4(Math.min(wGlo / COMP_SCORE_CEILING, 1.0)),
    weighted_ow_origin_usd: r2(wOri),
    weighted_ow_global_usd: r2(wGlo),
    comps_found:            rows.length,
    comps_used:             rows.map((r) => ({
      title:               r.title,
      release_date:        r.release_date,
      similarity_score:    r.similarity_score,
      match_reasons:       safeParse(r.match_reasons, []),
      actual_ow_origin_usd: r.comp_actual_ow_origin,
      actual_ow_global_usd: r.comp_actual_ow_global,
    })),
    data_available: true,
  };
}

/* ================================================================== */
/* computeCompScore(film)                                             */
/* ================================================================== */

export async function computeCompScore(film) {
  const filmDbId = film.id ?? null;

  /* ── Step 1: cache check ────────────────────────────────────────── */
  if (filmDbId) {
    const cached = db.prepare(`
      SELECT ca.*, f.title, f.revenue, f.release_date, f.market
      FROM comp_anchors ca
      JOIN films f ON ca.comp_film_id = f.id
      WHERE ca.upcoming_film_id = ?
      ORDER BY ca.similarity_score DESC
      LIMIT ?
    `).all(filmDbId, TOP_N);

    if (cached.length >= 3 && cached.every((r) => r.comp_actual_ow_global > 0)) {
      console.log(`[COMPS] Using cached comps for "${film.title}"`);
      return calcFromCached(cached);
    }
  }

  /* ── Step 2: find candidates ────────────────────────────────────── */
  const filmGenreNames = safeParse(film.genres, []);
  const primaryGenreName = filmGenreNames[0] ?? 'Action';
  const primaryGenreId   = GENRE_ID_MAP[primaryGenreName] ?? 28;
  const filmMarket       = film.market ?? 'hollywood';
  const filmBudget       = film.budget_inferred ? 150_000_000 : (film.budget ?? 0);

  console.log(`[COMPS] Finding comps for "${film.title}" (${filmMarket}, genre=${primaryGenreName})`);

  // TMDB discover candidates
  const discoverResults = await getReleasedFilmsForComps(
    [primaryGenreId],
    filmMarket,
    filmBudget || 150_000_000
  );

  // DB candidates (already have revenue)
  const dbRows = db.prepare(`
    SELECT * FROM films
    WHERE status = 'released'
      AND market = ?
      AND revenue > 0
      AND tmdb_id != ?
  `).all(filmMarket, film.tmdb_id ?? 0);

  // Merge, deduplicate by tmdb_id
  const seen       = new Set();
  const candidates = [];

  for (const row of dbRows) {
    seen.add(row.tmdb_id);
    candidates.push(normaliseDbRow(row));
  }
  for (const r of (discoverResults ?? [])) {
    if (!seen.has(r.tmdb_id)) {
      seen.add(r.tmdb_id);
      // If the DB already has this film (without revenue) use its data
      const existing = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(r.tmdb_id);
      candidates.push(existing ? normaliseDbRow(existing) : normaliseDiscover(r, filmMarket));
    }
  }

  console.log(`[COMPS] ${candidates.length} candidates found`);

  /* ── Step 3: prelim score → enrich top MAX_ENRICH ──────────────── */
  const byPrelim = candidates
    .map((c) => ({ ...c, prelim: prelimScore(film, c) }))
    .sort((a, b) => b.prelim - a.prelim)
    .slice(0, MAX_ENRICH);

  const enriched = [];
  for (const candidate of byPrelim) {
    const result = await enrichCandidate(candidate);
    if (result && result.revenue > 0) enriched.push(result);
  }

  console.log(`[COMPS] ${enriched.length} candidates after revenue enrichment`);

  if (enriched.length === 0) {
    return {
      score: 0.30,
      weighted_ow_origin_usd: null,
      weighted_ow_global_usd: null,
      comps_found: 0,
      comps_used:  [],
      data_available: false,
      reason: 'No comparable films found',
    };
  }

  /* ── Full similarity + OW estimation ────────────────────────────── */
  const scored = enriched.map((c) => {
    const { similarity_score, match_reasons } = fullScore(film, c);
    const { ow_origin, ow_global } = compOW(c.revenue, c.market);
    return { ...c, similarity_score, match_reasons, ow_origin, ow_global };
  }).sort((a, b) => b.similarity_score - a.similarity_score);

  const top5 = scored.slice(0, TOP_N);

  /* ── Step 4: persist comp_anchors ───────────────────────────────── */
  if (filmDbId) {
    db.prepare('DELETE FROM comp_anchors WHERE upcoming_film_id = ?').run(filmDbId);
    const ins = db.prepare(`
      INSERT INTO comp_anchors
        (upcoming_film_id, comp_film_id, similarity_score,
         match_reasons, comp_actual_ow_origin, comp_actual_ow_global)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const c of top5) {
      if (c.db_id) {
        ins.run(filmDbId, c.db_id, c.similarity_score,
                JSON.stringify(c.match_reasons), c.ow_origin, c.ow_global);
      }
    }
  }

  /* ── Weighted average (top WEIGHT_COMPS) ────────────────────────── */
  const top3 = top5.slice(0, WEIGHT_COMPS);
  const tw   = top3.reduce((s, c) => s + c.similarity_score, 0);
  const wOri = top3.reduce((s, c) => s + c.ow_origin * c.similarity_score, 0) / tw;
  const wGlo = top3.reduce((s, c) => s + c.ow_global * c.similarity_score, 0) / tw;

  const score = r4(Math.min(wGlo / COMP_SCORE_CEILING, 1.0));

  console.log(`[COMPS] weighted OW global = $${r2(wGlo)}M → comp_score = ${score}`);

  return {
    score,
    weighted_ow_origin_usd: r2(wOri),
    weighted_ow_global_usd: r2(wGlo),
    comps_found: top5.length,
    comps_used:  top5.map((c) => ({
      title:                c.title,
      release_date:         c.release_date,
      similarity_score:     c.similarity_score,
      match_reasons:        c.match_reasons,
      actual_ow_origin_usd: c.ow_origin,
      actual_ow_global_usd: c.ow_global,
    })),
    data_available: true,
  };
}
