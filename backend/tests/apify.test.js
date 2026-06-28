/**
 * apify.test.js — Live end-to-end sentiment scrape + prediction update.
 *
 * Makes real Apify API calls (Reddit + YouTube) and a real Claude call.
 * Expected runtime: 30–90 seconds.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { scrapeFilmSentiment } from '../services/apify.js';

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

const film = db.prepare('SELECT * FROM films WHERE tmdb_id = 969681').get();
if (!film) {
  console.error('Spider-Man: Brand New Day not in DB — run comps.test.js first');
  process.exit(1);
}

// Capture the prediction BEFORE the scrape for comparison.
const beforePred = db.prepare(
  'SELECT * FROM predictions WHERE film_id = ? ORDER BY generated_at DESC LIMIT 1'
).get(film.id);

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Apify Test — Spider-Man: Brand New Day');
console.log(`  film.id=${film.id}  trailer_url=${film.trailer_url ?? 'none'}`);
console.log('  (Live Apify + Claude calls — expect 30–90s)');
console.log('══════════════════════════════════════════════════════════════\n');

/* ------------------------------------------------------------------ */
/* Step 1 — scrapeFilmSentiment                                       */
/* ------------------------------------------------------------------ */

const scraped = await scrapeFilmSentiment(film);

if (!scraped) {
  console.log('\n⚠ scrapeFilmSentiment returned null — no data scraped.');
  console.log('  Check APIFY_API_KEY and whether actors are available.\n');
  process.exit(0);
}

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  SCRAPE RESULTS (pure volume scoring — no Claude call)');
console.log('──────────────────────────────────────────────────────────────');
console.log(`  sentiment_score:    ${scraped.sentiment_score}/5`);
console.log(`  sentiment_label:    ${scraped.sentiment_label}`);
console.log(`  sentiment_one_line: ${scraped.sentiment_one_line}`);
console.log(`  trailer_view_count: ${scraped.trailer_view_count.toLocaleString()}`);
console.log(`  mention_volume:     ${scraped.raw_mention_count.toLocaleString()} (posts + comments)`);
console.log(`  mention_velocity:   ${scraped.mention_velocity}%`);
console.log(`  snapshot_id:        ${scraped.snapshot_id}`);

/* ------------------------------------------------------------------ */
/* Step 2 — hit /refresh to regenerate prediction with new sentiment  */
/* ------------------------------------------------------------------ */

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  Calling /api/films/969681/refresh …');
console.log('──────────────────────────────────────────────────────────────');

let refreshed;
try {
  const res = await fetch('http://localhost:3001/api/films/969681/refresh');
  refreshed = await res.json();
} catch (err) {
  console.error('  Could not reach server:', err.message);
  console.log('  (Start the server with: node backend/server.js)');
  process.exit(0);
}

const pred = refreshed?.prediction;
if (!pred) {
  console.log('  ⚠ No prediction in refresh response:', JSON.stringify(refreshed));
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Step 3 — before vs after comparison                                */
/* ------------------------------------------------------------------ */

const fmt = (v) => (v != null ? String(v) : 'n/a');

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  BEFORE → AFTER COMPARISON');
console.log('──────────────────────────────────────────────────────────────');
console.log(`  sentiment_score   ${fmt(beforePred?.sentiment_score)} → ${pred.score_breakdown.sentiment}`);
console.log(`  final_score       ${fmt(beforePred?.final_score)}   → ${pred.score_breakdown.final}`);
console.log(`  global_ow_mid     $${fmt(beforePred?.global_ow_mid)}M → $${pred.opening_weekend.global.mid_usd}M`);
console.log(`  confidence        ${fmt(beforePred?.confidence)}   → ${pred.confidence}`);

console.log('\n  UPDATED ANALYST REPORT:');
console.log('──────────────────────────────────────────────────────────────');
if (pred.analyst_report) {
  console.log('\n  ' + pred.analyst_report.split('\n').join('\n  '));
} else {
  console.log('  (no report)');
}

console.log('\n══════════════════════════════════════════════════════════════\n');
