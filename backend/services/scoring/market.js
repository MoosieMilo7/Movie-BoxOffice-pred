/**
 * market.js — Release timing + competition pressure.
 *
 * season_score     — how favourable the calendar window is
 * competition_score — how many major films share the same weekend
 *
 * market_score = (season × 0.50) + (competition × 0.50)
 */
import db from '../../db/database.js';

/* ------------------------------------------------------------------ */
/* Season mapping                                                     */
/* ------------------------------------------------------------------ */

const SEASON_MAP = {
  1:  { score: 0.40, label: 'dump_season' },
  2:  { score: 0.40, label: 'dump_season' },
  3:  { score: 0.70, label: 'spring' },
  4:  { score: 0.70, label: 'spring' },
  5:  { score: 0.90, label: 'summer' },
  6:  { score: 0.90, label: 'summer' },
  7:  { score: 0.90, label: 'summer' },
  8:  { score: 0.60, label: 'shoulder' },
  9:  { score: 0.60, label: 'shoulder' },
  10: { score: 0.60, label: 'shoulder' },
  11: { score: 0.85, label: 'holiday' },
  12: { score: 0.85, label: 'holiday' },
};

function scoreSeason(releaseDate) {
  if (!releaseDate) {
    return { score: 0.50, label: 'unknown', release_month: null };
  }
  const month = parseInt(releaseDate.split('-')[1], 10);
  const entry = SEASON_MAP[month] ?? { score: 0.50, label: 'unknown' };
  return { score: entry.score, label: entry.label, release_month: month };
}

/* ------------------------------------------------------------------ */
/* Competition mapping                                                */
/* ------------------------------------------------------------------ */

function competitionScore(count) {
  if (count === 0) return { score: 1.00, label: 'clear_run' };
  if (count === 1) return { score: 0.70, label: 'some_competition' };
  if (count === 2) return { score: 0.50, label: 'competitive_weekend' };
  return              { score: 0.30, label: 'crowded_weekend' };
}

function isMajorCompetitor(row) {
  return (
    (row.budget ?? 0) >= 80_000_000 ||
    !!row.budget_inferred ||
    (row.belongs_to_collection != null && row.belongs_to_collection !== '')
  );
}

function scoreCompetition(film) {
  if (!film.release_date) {
    return {
      score: 1.00,
      label: 'clear_run',
      major_competitor_count: 0,
      competitor_titles: [],
    };
  }

  const candidates = db.prepare(`
    SELECT tmdb_id, title, budget, budget_inferred, belongs_to_collection
    FROM films
    WHERE release_date BETWEEN date(?, '-7 days') AND date(?, '+7 days')
      AND tmdb_id != ?
      AND status IN ('upcoming', 'in_production', 'fresh_release')
  `).all(film.release_date, film.release_date, film.tmdb_id ?? 0);

  const major = candidates.filter(isMajorCompetitor);
  const { score, label } = competitionScore(major.length);

  return {
    score,
    label,
    major_competitor_count: major.length,
    competitor_titles: major.map((r) => r.title),
  };
}

/* ------------------------------------------------------------------ */
/* Days until release                                                 */
/* ------------------------------------------------------------------ */

function daysUntilRelease(releaseDate) {
  if (!releaseDate) return null;
  const diff = new Date(releaseDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/* ================================================================== */
/* computeMarketScore(film)                                           */
/* ================================================================== */

export function computeMarketScore(film) {
  const season      = scoreSeason(film.release_date ?? null);
  const competition = scoreCompetition(film);
  const days        = daysUntilRelease(film.release_date ?? null);

  const score = Math.round(
    (season.score * 0.50 + competition.score * 0.50) * 10_000
  ) / 10_000;

  return {
    score,
    components: {
      season: {
        score:         season.score,
        label:         season.label,
        release_month: season.release_month,
      },
      competition: {
        score:                  competition.score,
        label:                  competition.label,
        major_competitor_count: competition.major_competitor_count,
        competitor_titles:      competition.competitor_titles,
      },
    },
    days_until_release: days,
    release_date:       film.release_date ?? null,
  };
}
