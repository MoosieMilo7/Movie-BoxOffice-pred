/**
 * sentiment.js — Reads the latest Apify sentiment snapshot and normalises to 0-1.
 *
 * The actual sentiment analysis (Claude + Apify) is handled upstream.
 * This module is read-only: fetch latest snapshot, convert, return.
 */
import db from '../../db/database.js';

const NO_DATA_RESULT = {
  score: 0.35,
  raw_score: null,
  label: 'no_data',
  one_line: 'No social data scraped yet',
  data_available: false,
  scraped_at: null,
};

export function computeSentimentScore(film_id) {
  const snapshot = db
    .prepare(
      `SELECT * FROM sentiment_snapshots
       WHERE film_id = ?
       ORDER BY scraped_at DESC
       LIMIT 1`
    )
    .get(film_id);

  if (!snapshot) return NO_DATA_RESULT;

  const normalized = (snapshot.sentiment_score ?? 0) / 5;

  return {
    score:              normalized,
    raw_score:          snapshot.sentiment_score,
    label:              snapshot.sentiment_label      ?? null,
    one_line:           snapshot.sentiment_one_line   ?? null,
    data_available:     true,
    trailer_view_count: snapshot.trailer_view_count   ?? 0,
    raw_mention_count:  snapshot.raw_mention_count    ?? 0,
    scraped_at:         snapshot.scraped_at           ?? null,
  };
}
