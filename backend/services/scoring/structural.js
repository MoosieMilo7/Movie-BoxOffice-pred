/**
 * structural.js — Deterministic structural score (0-1)
 *
 * Pure math. No API calls. No AI.
 * Only external dependency: db (SQLite, read-only here).
 *
 * Weights:
 *   budget   × 0.30
 *   franchise× 0.25
 *   genre    × 0.20
 *   talent   × 0.15
 *   mpaa     × 0.10
 */
import db from '../../db/database.js';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const GENRE_SCORES = {
  'Action':         0.80,
  'Adventure':      0.80,
  'Animation':      0.75,
  'Family':         0.75,
  'Science Fiction':0.70,
  'Fantasy':        0.70,
  'Horror':         0.65,
  'Comedy':         0.60,
  'Thriller':       0.55,
  'Crime':          0.55,
  'Mystery':        0.50,
  'Music':          0.50,
  'Romance':        0.45,
  'War':            0.45,
  'Drama':          0.40,
  'Biography':      0.40,
  'History':        0.35,
  'Western':        0.35,
  'Documentary':    0.20,
};

const MPAA_SCORES = {
  'G':     0.70,
  'PG':    0.75,
  'PG-13': 0.85,
  'R':     0.60,
  'NC-17': 0.20,
  'NR':    0.40,
};

const MAJOR_STUDIO_SIGNALS = [
  'disney', 'marvel', 'warner', 'universal', 'paramount',
  'sony', 'lionsgate', 'netflix', 'apple', 'amazon', 'a24',
  'dreamworks', 'pixar', 'new line', 'columbia',
  '20th century', 'searchlight',
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/* ------------------------------------------------------------------ */
/* Budget sub-score                                                   */
/* ------------------------------------------------------------------ */

function scoreBudget(film) {
  const budget = parseInt(film.budget, 10) || 0;
  const inferred = !!film.budget_inferred;

  let score;
  let tier;

  if (budget >= 150_000_000) {
    score = 1.00; tier = 'tentpole';
  } else if (budget >= 80_000_000) {
    score = 0.80; tier = 'major';
  } else if (budget >= 25_000_000) {
    score = 0.55; tier = 'mid';
  } else if (budget >= 5_000_000) {
    score = 0.30; tier = 'indie';
  } else if (budget > 0) {
    score = 0.15; tier = 'micro';
  } else if (budget === 0 && inferred) {
    score = 0.65; tier = 'unknown';
  } else {
    score = 0.10; tier = 'unknown';
  }

  return { score, tier, value: budget };
}

/* ------------------------------------------------------------------ */
/* Franchise sub-score (DB lookup)                                    */
/* ------------------------------------------------------------------ */

function scoreFranchise(film) {
  const collection = safeParse(film.belongs_to_collection, null);

  if (!collection || !collection.id) {
    return { score: 0.30, label: 'original_ip' };
  }

  // Query for prior films in the same collection with known revenue.
  // Uses json_extract (SQLite 3.38+); falls back to a JS-side filter if unavailable.
  let maxRevenue = 0;
  let priorFilmsFound = 0;

  try {
    const row = db.prepare(`
      SELECT MAX(revenue) AS max_rev, COUNT(*) AS cnt
      FROM films
      WHERE json_extract(belongs_to_collection, '$.id') = ?
        AND status = 'released'
        AND revenue > 0
        AND tmdb_id != ?
    `).get(collection.id, film.tmdb_id || 0);

    maxRevenue    = row?.max_rev ?? 0;
    priorFilmsFound = row?.cnt    ?? 0;
  } catch {
    // json_extract not available — filter in JS.
    const rows = db.prepare(
      `SELECT revenue, belongs_to_collection FROM films
       WHERE status = 'released' AND revenue > 0 AND tmdb_id != ?`
    ).all(film.tmdb_id || 0);

    for (const r of rows) {
      const col = safeParse(r.belongs_to_collection, null);
      if (col?.id === collection.id) {
        priorFilmsFound++;
        if ((r.revenue || 0) > maxRevenue) maxRevenue = r.revenue;
      }
    }
  }

  if (priorFilmsFound === 0) {
    return { score: 0.65, label: 'franchise_unverified' };
  }
  if (maxRevenue >= 500_000_000) {
    return { score: 0.95, label: 'mega_franchise' };
  }
  if (maxRevenue >= 100_000_000) {
    return { score: 0.80, label: 'major_franchise' };
  }
  return { score: 0.65, label: 'franchise' };
}

/* ------------------------------------------------------------------ */
/* Genre sub-score                                                    */
/* ------------------------------------------------------------------ */

function scoreGenre(film) {
  const genres = safeParse(film.genres, []);
  if (!genres.length) {
    return { score: 0.45, primary_genre: 'unknown' };
  }
  let best = { genre: genres[0], score: GENRE_SCORES[genres[0]] ?? 0.45 };
  for (const g of genres) {
    const s = GENRE_SCORES[g] ?? 0.45;
    if (s > best.score) best = { genre: g, score: s };
  }
  return { score: best.score, primary_genre: best.genre };
}

/* ------------------------------------------------------------------ */
/* Talent sub-score (DB lookup)                                       */
/* ------------------------------------------------------------------ */

function scoreTalent(film) {
  const director = safeParse(film.director, null);
  const cast     = safeParse(film.cast_top5, []);

  const DEFAULT = 0.35;

  // Director
  let directorScore = DEFAULT;
  let directorFound = false;
  if (director?.tmdb_person_id) {
    const row = db.prepare(
      'SELECT avg_ow_when_leading FROM talent_scores WHERE tmdb_person_id = ? AND role = ?'
    ).get(director.tmdb_person_id, 'director');
    if (row) {
      directorScore = Math.min(row.avg_ow_when_leading / 200_000_000, 1.0);
      directorFound = true;
    }
  }

  // Top 2 cast
  const top2 = cast.slice(0, 2).filter((c) => c.tmdb_person_id);
  let castScore = DEFAULT;
  let castFound = 0;
  if (top2.length > 0) {
    const ids = top2.map((c) => c.tmdb_person_id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT avg_ow_when_leading FROM talent_scores
       WHERE tmdb_person_id IN (${placeholders}) AND role = 'actor'`
    ).all(...ids);
    castFound = rows.length;
    if (rows.length > 0) {
      const avg = rows.reduce((s, r) => s + r.avg_ow_when_leading, 0) / rows.length;
      castScore = Math.min(avg / 150_000_000, 1.0);
    }
  }

  const score = round4(directorScore * 0.40 + castScore * 0.60);
  return { score, director_score: directorScore, cast_score: castScore, director_found: directorFound, cast_found: castFound };
}

/* ------------------------------------------------------------------ */
/* MPAA sub-score                                                     */
/* ------------------------------------------------------------------ */

function scoreMpaa(film) {
  const rating = film.mpaa_rating || null;
  const score  = MPAA_SCORES[rating] ?? 0.50;
  return { score, rating: rating ?? 'unknown' };
}

/* ------------------------------------------------------------------ */
/* Production company bonus                                           */
/* ------------------------------------------------------------------ */

function checkMajorStudio(film) {
  const companies = safeParse(film.production_companies, []);
  return companies.some((c) =>
    MAJOR_STUDIO_SIGNALS.some((sig) => (c.name ?? '').toLowerCase().includes(sig))
  );
}

/* ================================================================== */
/* computeStructuralScore(film)                                       */
/* ================================================================== */

export function computeStructuralScore(film) {
  // Sub-scores
  const budget   = scoreBudget(film);
  const franchise = scoreFranchise(film);
  const genre    = scoreGenre(film);
  const talent   = scoreTalent(film);
  const mpaa     = scoreMpaa(film);

  const majorStudio = checkMajorStudio(film);

  // Production company bonus: if budget unknown but major studio, floor budget_score at 0.65.
  const rawBudget = parseInt(film.budget, 10) || 0;
  if (rawBudget === 0 && majorStudio) {
    budget.score = Math.max(budget.score, 0.65);
  }

  const score = round4(
    budget.score    * 0.30 +
    franchise.score * 0.25 +
    genre.score     * 0.20 +
    talent.score    * 0.15 +
    mpaa.score      * 0.10
  );

  return {
    score,
    components: {
      budget:   { score: budget.score,   tier: budget.tier,              value: budget.value },
      franchise:{ score: franchise.score, label: franchise.label },
      genre:    { score: genre.score,    primary_genre: genre.primary_genre },
      talent:   {
        score:          talent.score,
        director_score: round4(talent.director_score),
        cast_score:     round4(talent.cast_score),
        director_found: talent.director_found,
        cast_found:     talent.cast_found,
      },
      mpaa:     { score: mpaa.score,     rating: mpaa.rating },
    },
    major_studio: majorStudio,
  };
}
