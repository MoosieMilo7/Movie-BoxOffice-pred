import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { computeMomentumScore } from '../services/scoring/momentum.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected, tolerance = 0) {
  const ok = tolerance
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  const tag = ok ? '✅' : '❌';
  const exp = tolerance ? `≈${expected}` : JSON.stringify(expected);
  console.log(`  ${tag} ${label.padEnd(28)} expected=${exp}  got=${JSON.stringify(actual)}`);
  ok ? passed++ : failed++;
}

const insertSnapshot = db.prepare(`
  INSERT INTO sentiment_snapshots (
    film_id, scraped_at, sentiment_score, sentiment_label,
    sentiment_one_line, trailer_view_count, raw_mention_count,
    previous_mention_count, mention_velocity
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/* ─────────────────────────────────────────────────────────────── */
/* TEST 1 — No data                                               */
/* ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 1: film_id=99999 — no snapshots');
console.log('──────────────────────────────────────────────────');

const r1 = computeMomentumScore(99999);
console.log('  Result:', JSON.stringify(r1, null, 2));
console.log('\n  Assertions:');
check('score',          r1.score,          0.30);
check('data_available', r1.data_available, false);

/* ─────────────────────────────────────────────────────────────── */
/* Set up: parent film row for tests 2 + 3                        */
/* ─────────────────────────────────────────────────────────────── */
const filmRow = db.prepare(
  "INSERT OR IGNORE INTO films (tmdb_id, title, status) VALUES (99990002, 'Test Film (momentum)', 'upcoming')"
).run();
const testFilmId = filmRow.lastInsertRowid ||
  db.prepare("SELECT id FROM films WHERE tmdb_id = 99990002").get().id;

/* ─────────────────────────────────────────────────────────────── */
/* TEST 2 — Single snapshot (first scrape, no velocity)           */
/* ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 2: 1 snapshot — velocity unknowable (first scrape)');
console.log('──────────────────────────────────────────────────');

insertSnapshot.run(
  testFilmId,
  new Date(Date.now() - 86_400_000).toISOString(), // yesterday
  3, 'hot', 'Building buzz',
  12_000_000,   // trailer_view_count
  85_000,       // raw_mention_count
  0,            // previous_mention_count
  0             // mention_velocity (0 = first scrape stored as 0)
);

const r2 = computeMomentumScore(testFilmId);
console.log('  Result:', JSON.stringify(r2, null, 2));
console.log('\n  Assertions:');
check('mention_velocity score', r2.components.mention_velocity.score, 0.40);
check('mention_velocity label', r2.components.mention_velocity.label, 'no_data');
check('trailer_velocity score', r2.components.trailer_velocity.score, 0.40);
check('trailer prev_views',     r2.components.trailer_velocity.previous_views, null);
check('volume score',           r2.components.volume.score, 0.17);
check('score',                  r2.score, 0.3425);
check('data_available',         r2.data_available, true);

/* ─────────────────────────────────────────────────────────────── */
/* TEST 3 — Two snapshots (velocity calculable)                   */
/* ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 3: 2 snapshots — velocity fires');
console.log('──────────────────────────────────────────────────');

insertSnapshot.run(
  testFilmId,
  new Date().toISOString(),  // now
  4, 'very_hot', 'Exploding online',
  28_000_000,   // trailer_view_count (12M → 28M = +133%)
  210_000,      // raw_mention_count  (85k → 210k = +147%)
  85_000,       // previous_mention_count
  147.1         // mention_velocity stored by Apify pipeline
);

const r3 = computeMomentumScore(testFilmId);
console.log('  Result:', JSON.stringify(r3, null, 2));

// Trailer: (28M - 12M) / 12M * 100 = 133.33%
const expectedTrailerPct = Math.round(((28_000_000 - 12_000_000) / 12_000_000) * 100 * 10000) / 10000;
// volume: 210000 / 500000 = 0.42
// score:  1.00*0.40 + 1.00*0.35 + 0.42*0.25 = 0.40 + 0.35 + 0.105 = 0.855

console.log('\n  Assertions:');
check('mention_velocity score',  r3.components.mention_velocity.score,       1.00);
check('mention_velocity label',  r3.components.mention_velocity.label,       'doubling');
check('mention_velocity pct',    r3.components.mention_velocity.velocity_pct, 147.1);
check('trailer_velocity score',  r3.components.trailer_velocity.score,        1.00);
check('trailer_velocity pct',    r3.components.trailer_velocity.velocity_pct, expectedTrailerPct);
check('trailer current_views',   r3.components.trailer_velocity.current_views, 28_000_000);
check('trailer previous_views',  r3.components.trailer_velocity.previous_views, 12_000_000);
check('volume score',            r3.components.volume.score, 0.42);
check('volume raw_count',        r3.components.volume.raw_count, 210_000);
check('score',                   r3.score, 0.855);
check('data_available',          r3.data_available, true);

/* ─────────────────────────────────────────────────────────────── */
/* Summary + cleanup                                              */
/* ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed + failed} checks — ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────\n');

db.prepare('DELETE FROM films WHERE tmdb_id = 99990002').run(); // cascades snapshots
