/**
 * filmMode.js — Single source of truth for prediction gating.
 *
 * NEVER uses TMDB's status field. Only revenue presence + release date matter.
 *
 * Modes:
 *   'upcoming'      — release date in the future, predict
 *   'fresh_release' — released ≤30 days ago, no revenue yet, still predict
 *   'released'      — has revenue OR released >30 days ago, comp-only
 */
export function determineFilmMode(film_data) {
  const today          = new Date();
  const releaseDate    = film_data.release_date ? new Date(film_data.release_date) : null;
  const daysUntil      = releaseDate ? Math.ceil((releaseDate - today) / 86_400_000) : null;
  const daysSince      = releaseDate ? Math.floor((today - releaseDate) / 86_400_000) : null;
  const hasRevenue     = (film_data.revenue ?? 0) > 0;

  if (hasRevenue) {
    return { mode: 'released', predict: false, reason: 'Revenue data confirmed' };
  }
  if (daysUntil !== null && daysUntil > 0) {
    return { mode: 'upcoming', predict: true, days_until_release: daysUntil, reason: 'Release date is in the future' };
  }
  if (daysSince !== null && daysSince <= 30) {
    return { mode: 'fresh_release', predict: true, days_since_release: daysSince, reason: 'Recently opened, awaiting revenue data' };
  }
  if (daysSince !== null && daysSince > 30) {
    return { mode: 'released', predict: false, reason: 'Released over 30 days ago, no revenue data available' };
  }
  return { mode: 'upcoming', predict: true, days_until_release: null, reason: 'No release date confirmed yet' };
}
