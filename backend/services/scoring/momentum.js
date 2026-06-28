/**
 * momentum.js — Measures buzz acceleration, not just buzz level.
 *
 * Three signals:
 *   mention_velocity  — % change in social mentions (stored in snapshot)
 *   trailer_velocity  — % change in YouTube view count between snapshots
 *   volume            — absolute mention count normalised to 0-1
 *
 * Weights: mention ×0.40 + trailer ×0.35 + volume ×0.25
 */
import db from '../../db/database.js';

const NO_DATA_RESULT = {
  score: 0.30,
  mention_velocity:  null,
  trailer_velocity:  null,
  volume_score:      0,
  data_available:    false,
  reason:            'No social data yet',
};

const VOLUME_CEILING = 500_000;

/* ------------------------------------------------------------------ */
/* Shared velocity helpers                                            */
/* ------------------------------------------------------------------ */

function velocityToScore(pct) {
  if (pct === null)  return 0.40;
  if (pct >= 100)    return 1.00;
  if (pct >= 50)     return 0.85;
  if (pct >= 20)     return 0.70;
  if (pct >= 5)      return 0.55;
  if (pct >= 0)      return 0.40;
  if (pct >= -20)    return 0.25;
  return 0.10;
}

function velocityLabel(pct) {
  if (pct === null)  return 'no_data';
  if (pct >= 100)    return 'doubling';
  if (pct >= 50)     return 'strong';
  if (pct >= 20)     return 'healthy';
  if (pct >= 5)      return 'mild';
  if (pct >= 0)      return 'flat';
  if (pct >= -20)    return 'declining';
  return 'falling';
}

function round4(n) {
  return Math.round(n * 10_000) / 10_000;
}

/* ================================================================== */
/* computeMomentumScore(film_id)                                      */
/* ================================================================== */

export function computeMomentumScore(film_id) {
  const snapshots = db
    .prepare(
      `SELECT * FROM sentiment_snapshots
       WHERE film_id = ?
       ORDER BY scraped_at DESC
       LIMIT 2`
    )
    .all(film_id);

  if (!snapshots.length) return NO_DATA_RESULT;

  const latest   = snapshots[0];
  const previous = snapshots[1] ?? null;

  /* ── Mention velocity ─────────────────────────────────────────── */
  // Use stored mention_velocity; fall back to neutral if first scrape.
  const mentionVelocityPct = (previous === null || latest.mention_velocity == null)
    ? null
    : latest.mention_velocity;

  const mentionVelocityScore = velocityToScore(mentionVelocityPct);

  /* ── Trailer velocity ─────────────────────────────────────────── */
  let trailerVelocityPct = null;
  if (
    previous !== null &&
    (latest.trailer_view_count   ?? 0) > 0 &&
    (previous.trailer_view_count ?? 0) > 0
  ) {
    trailerVelocityPct = round4(
      ((latest.trailer_view_count - previous.trailer_view_count) /
        previous.trailer_view_count) * 100
    );
  }

  const trailerVelocityScore = velocityToScore(trailerVelocityPct);

  /* ── Volume ───────────────────────────────────────────────────── */
  const rawCount   = latest.raw_mention_count ?? 0;
  const volumeScore = round4(Math.min(rawCount / VOLUME_CEILING, 1.0));

  /* ── Final score ──────────────────────────────────────────────── */
  const score = round4(
    mentionVelocityScore * 0.40 +
    trailerVelocityScore * 0.35 +
    volumeScore          * 0.25
  );

  return {
    score,
    components: {
      mention_velocity: {
        score:        mentionVelocityScore,
        velocity_pct: mentionVelocityPct,
        label:        velocityLabel(mentionVelocityPct),
      },
      trailer_velocity: {
        score:          trailerVelocityScore,
        velocity_pct:   trailerVelocityPct,
        current_views:  latest.trailer_view_count   ?? 0,
        previous_views: previous?.trailer_view_count ?? null,
      },
      volume: {
        score:     volumeScore,
        raw_count: rawCount,
        ceiling:   VOLUME_CEILING,
      },
    },
    data_available: true,
  };
}
