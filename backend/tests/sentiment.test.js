import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { computeSentimentScore } from '../services/scoring/sentiment.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(22)} expected=${JSON.stringify(expected)}  got=${JSON.stringify(actual)}`);
  ok ? passed++ : failed++;
}

/* ------------------------------------------------------------------ */
/* TEST 1 — No snapshot exists                                        */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 1: film_id=99999 (no snapshot in DB)');
console.log('──────────────────────────────────────────────────');

const result1 = computeSentimentScore(99999);
console.log('  Full result:', JSON.stringify(result1, null, 4));
console.log('\n  Assertions:');
check('score',          result1.score,          0.35);
check('data_available', result1.data_available, false);
check('label',          result1.label,          'no_data');
check('raw_score',      result1.raw_score,      null);
check('scraped_at',     result1.scraped_at,     null);

/* ------------------------------------------------------------------ */
/* TEST 2 — Insert fake snapshot then read it                         */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 2: insert snapshot for film_id=1, then score');
console.log('──────────────────────────────────────────────────');

// Insert a minimal parent film row so the FK constraint is satisfied.
const filmInfo = db.prepare(`
  INSERT OR IGNORE INTO films (tmdb_id, title, status)
  VALUES (99990001, 'Test Film (sentiment test)', 'upcoming')
`).run();
const testFilmId = filmInfo.lastInsertRowid || db.prepare(
  "SELECT id FROM films WHERE tmdb_id = 99990001"
).get().id;

// Insert the fake snapshot.
db.prepare(`
  INSERT INTO sentiment_snapshots (
    film_id, scraped_at, sentiment_score, sentiment_label,
    sentiment_one_line, trailer_view_count, raw_mention_count,
    previous_mention_count, mention_velocity
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  testFilmId,
  new Date().toISOString(),
  4,
  'very_hot',
  'Fans are going wild for this one',
  45_000_000,
  280_000,
  180_000,
  55.6
);

const result2 = computeSentimentScore(testFilmId);
console.log('  Full result:', JSON.stringify(result2, null, 4));
console.log('\n  Assertions:');
check('score',              result2.score,              0.8);
check('data_available',     result2.data_available,     true);
check('raw_score',          result2.raw_score,          4);
check('label',              result2.label,              'very_hot');
check('one_line',           result2.one_line,           'Fans are going wild for this one');
check('trailer_view_count', result2.trailer_view_count, 45_000_000);
check('raw_mention_count',  result2.raw_mention_count,  280_000);

/* ------------------------------------------------------------------ */
/* Summary                                                            */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed + failed} checks — ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────\n');

// Clean up — cascade deletes the snapshot too (FK ON DELETE CASCADE).
db.prepare('DELETE FROM films WHERE tmdb_id = 99990001').run();
