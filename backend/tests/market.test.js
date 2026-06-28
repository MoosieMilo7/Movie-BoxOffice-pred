import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { computeMarketScore } from '../services/scoring/market.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected, tolerance = 0) {
  const ok = tolerance
    ? Math.abs(actual - expected) <= tolerance
    : JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? '✅' : '❌'} ${label.padEnd(30)} expected=${JSON.stringify(expected)}${tolerance ? ` ±${tolerance}` : ''}  got=${JSON.stringify(actual)}`
  );
  ok ? passed++ : failed++;
}

/* ──────────────────────────────────────────────────────────────── */
/* Seed test films                                                  */
/* ──────────────────────────────────────────────────────────────── */

const upsert = db.prepare(`
  INSERT INTO films (tmdb_id, title, release_date, status, budget, budget_inferred, belongs_to_collection, market)
  VALUES (@tmdb_id, @title, @release_date, @status, @budget, @budget_inferred, @belongs_to_collection, @market)
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title                = excluded.title,
    release_date         = excluded.release_date,
    status               = excluded.status,
    budget               = excluded.budget,
    budget_inferred      = excluded.budget_inferred,
    belongs_to_collection= excluded.belongs_to_collection,
    market               = excluded.market
`);

// Film A — Spider-Man: Brand New Day (July 2026 = summer)
upsert.run({
  tmdb_id:               969681,
  title:                 'Spider-Man: Brand New Day',
  release_date:          '2026-07-29',
  status:                'upcoming',
  budget:                0,
  budget_inferred:       1,
  belongs_to_collection: JSON.stringify({ id: 556 }),
  market:                'hollywood',
});

// Film B — a big-budget competitor opening same weekend
upsert.run({
  tmdb_id:               999001,
  title:                 'Fake Competitor Blockbuster',
  release_date:          '2026-07-31',
  status:                'upcoming',
  budget:                120_000_000,
  budget_inferred:       0,
  belongs_to_collection: null,
  market:                'hollywood',
});

const filmA = db.prepare('SELECT * FROM films WHERE tmdb_id = 969681').get();

/* ──────────────────────────────────────────────────────────────── */
/* TEST 1 — Summer release with one major competitor               */
/* ──────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 1: Spider-Man: Brand New Day (2026-07-29)');
console.log('──────────────────────────────────────────────────');

const r1 = computeMarketScore(filmA);
console.log('  Full result:\n', JSON.stringify(r1, null, 2));

// days from today (2026-06-27) to 2026-07-29 = 32 days
const expectedDays = Math.ceil(
  (new Date('2026-07-29').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
);

console.log('\n  Assertions:');
check('season.score',           r1.components.season.score,                    0.90);
check('season.label',           r1.components.season.label,                    'summer');
check('season.release_month',   r1.components.season.release_month,            7);
check('competition.score',      r1.components.competition.score,               0.70);
check('competition.label',      r1.components.competition.label,               'some_competition');
check('competitor count',       r1.components.competition.major_competitor_count, 1);
check('competitor_titles',      r1.components.competition.competitor_titles,   ['Fake Competitor Blockbuster']);
check('market_score',           r1.score,                                      0.80);
check('days_until_release',     r1.days_until_release, expectedDays, 1); // ±1 day tolerance
check('release_date',           r1.release_date,                               '2026-07-29');

/* ──────────────────────────────────────────────────────────────── */
/* TEST 2 — No release date                                        */
/* ──────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log('  TEST 2: Film with no release_date');
console.log('──────────────────────────────────────────────────');

const filmNoDate = { tmdb_id: 999999, release_date: null, status: 'upcoming' };
const r2 = computeMarketScore(filmNoDate);
console.log('  Full result:\n', JSON.stringify(r2, null, 2));

console.log('\n  Assertions:');
check('season.score',           r2.components.season.score,                    0.50);
check('season.label',           r2.components.season.label,                    'unknown');
check('season.release_month',   r2.components.season.release_month,            null);
check('competition.score',      r2.components.competition.score,               1.00);
check('competition.label',      r2.components.competition.label,               'clear_run');
check('competitor count',       r2.components.competition.major_competitor_count, 0);
check('market_score',           r2.score,                                      0.75);
check('days_until_release',     r2.days_until_release,                        null);

/* ──────────────────────────────────────────────────────────────── */
/* Summary + cleanup                                               */
/* ──────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed + failed} checks — ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────\n');

db.prepare('DELETE FROM films WHERE tmdb_id IN (969681, 999001)').run();
