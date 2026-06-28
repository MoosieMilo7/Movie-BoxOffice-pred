import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { computeConfidence } from '../services/scoring/confidence.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(26)} expected=${JSON.stringify(expected)}  got=${JSON.stringify(actual)}`);
  ok ? passed++ : failed++;
}

/* ------------------------------------------------------------------ */
/* Base film from DB                                                  */
/* ------------------------------------------------------------------ */
const dbFilm = db.prepare('SELECT * FROM films WHERE tmdb_id = 969681').get();
// Spider-Man: Brand New Day  release=2026-07-29  budget_inferred=1

// Helper: how many days from today to 2026-07-29?
const daysToRelease = Math.ceil(
  (new Date('2026-07-29').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
);
console.log(`\n  Base film: "${dbFilm?.title}" | days until release ≈ ${daysToRelease}`);
console.log(`  (Base confidence from days=${daysToRelease}: ${daysToRelease > 30 ? 'medium' : 'high'})`);

function printResult(label, r) {
  console.log(`\n  ── ${label} ──`);
  console.log(`  level:             ${r.level}`);
  console.log(`  range_multiplier:  ${r.range_multiplier}`);
  console.log(`  days_until_release:${r.days_until_release}`);
  console.log(`  reason:            ${r.reason}`);
  console.log(`  adjustments:`);
  console.log(`    base:            ${r.adjustments.base}`);
  console.log(`    upgrades:        [${r.adjustments.upgrades.join(' | ')}]`);
  console.log(`    downgrades:      [${r.adjustments.downgrades.join(' | ')}]`);
  console.log(`    ceiling_applied: ${r.adjustments.ceiling_applied}`);
  console.log(`    floor_applied:   ${r.adjustments.floor_applied}`);
}

/* ================================================================== */
/* TEST 1 — No data at all (early announcement, budget unknown)      */
/*                                                                    */
/* film:    budget=0, budget_inferred=0                              */
/* sentiment: data_available=false                                   */
/* comps:   comps_found=0                                            */
/*                                                                    */
/* Trace:                                                             */
/*   base (days≈32, >30): medium                                     */
/*   upgrades: budget? NO (budget=0, inferred=0)                     */
/*             sentiment? NO (false)                                 */
/*             comps? NO (0<3)                                        */
/*   downgrades: noBudget (0 AND !inferred) → medium→low            */
/*               sentMissingSoon? false (32 NOT <30) → NO            */
/*   ceiling: days=32 >30 → max=high. low≤high → no ceiling         */
/*   floor: not triggered                                            */
/*   RESULT: low                                                     */
/* ================================================================== */
console.log('\n══════════════════════════════════════════════════');
console.log('  TEST 1 — No data at all');
console.log('══════════════════════════════════════════════════');

const film1 = { ...dbFilm, budget: 0, budget_inferred: 0 };
const sent1 = { data_available: false };
const comp1 = { comps_found: 0 };

const r1 = computeConfidence(film1, sent1, comp1);
printResult('TEST 1', r1);
console.log('\n  Assertions:');
check('level',            r1.level,                       'low');
check('range_multiplier', r1.range_multiplier,            0.60);
check('base',             r1.adjustments.base,            'medium');
check('upgrades count',   r1.adjustments.upgrades.length, 0);
check('downgrades[0]',    r1.adjustments.downgrades[0],   'budget unknown');
check('ceiling_applied',  r1.adjustments.ceiling_applied, false);
check('floor_applied',    r1.adjustments.floor_applied,   false);

/* ================================================================== */
/* TEST 2 — Budget inferred, no sentiment, good comps (3)            */
/*                                                                    */
/* film:    budget=0, budget_inferred=1                              */
/* sentiment: data_available=false                                   */
/* comps:   comps_found=3                                            */
/*                                                                    */
/* Trace:                                                             */
/*   base (days≈32, >30): medium                                     */
/*   upgrades:                                                        */
/*     budget_inferred=1 → +1 → high     (upgradeCount=1)           */
/*     sentiment=false → NO                                          */
/*     comps=3 ≥ 3 → +1 → very_high     (upgradeCount=2, max hit)  */
/*   downgrades: noBudget? NO (inferred=1). sentSoon? NO (32≥30)    */
/*   ceiling: days=32 >30 → max=high. very_high>high → cap to high  */
/*   RESULT: high                                                     */
/* ================================================================== */
console.log('\n══════════════════════════════════════════════════');
console.log('  TEST 2 — Budget inferred + good comps, no sentiment');
console.log('══════════════════════════════════════════════════');

const film2 = { ...dbFilm, budget: 0, budget_inferred: 1 };
const sent2 = { data_available: false };
const comp2 = { comps_found: 3 };

const r2 = computeConfidence(film2, sent2, comp2);
printResult('TEST 2', r2);
console.log('\n  Assertions:');
check('level',                 r2.level,                          'high');
check('range_multiplier',      r2.range_multiplier,               0.25);
check('base',                  r2.adjustments.base,               'medium');
check('upgrades count',        r2.adjustments.upgrades.length,    2);
check('upgrades[0]',           r2.adjustments.upgrades[0],        'budget inferred from franchise');
check('upgrades[1]',           r2.adjustments.upgrades[1],        'strong comp anchor (3 films)');
check('downgrades count',      r2.adjustments.downgrades.length,  0);
check('ceiling_applied',       r2.adjustments.ceiling_applied,    true);

/* ================================================================== */
/* TEST 3 — Full data (budget inferred + sentiment + 5 comps)        */
/*                                                                    */
/* film:    budget=0, budget_inferred=1                              */
/* sentiment: data_available=true                                    */
/* comps:   comps_found=5                                            */
/*                                                                    */
/* Trace:                                                             */
/*   base (days≈32): medium                                          */
/*   upgrades:                                                        */
/*     budget_inferred=1 → +1 → high     (count=1)                  */
/*     sentiment=true    → +1 → very_high(count=2, max hit)         */
/*     comps=5 → would +1 but count already = 2 → SKIPPED           */
/*   downgrades: none                                                 */
/*   ceiling: days=32 >30 → max=high. very_high>high → cap to high  */
/*   RESULT: high                                                     */
/* ================================================================== */
console.log('\n══════════════════════════════════════════════════');
console.log('  TEST 3 — Full data (budget + sentiment + 5 comps)');
console.log('══════════════════════════════════════════════════');

const film3 = { ...dbFilm, budget: 0, budget_inferred: 1 };
const sent3 = { data_available: true };
const comp3 = { comps_found: 5 };

const r3 = computeConfidence(film3, sent3, comp3);
printResult('TEST 3', r3);
console.log('\n  Assertions:');
check('level',            r3.level,                          'high');
check('range_multiplier', r3.range_multiplier,               0.25);
check('base',             r3.adjustments.base,               'medium');
check('upgrades count',   r3.adjustments.upgrades.length,    2);
check('upgrades[0]',      r3.adjustments.upgrades[0],        'budget inferred from franchise');
check('upgrades[1]',      r3.adjustments.upgrades[1],        'social data available');
check('ceiling_applied',  r3.adjustments.ceiling_applied,    true);
check('reason includes comps', r3.reason.includes('strong comp anchor (5 films)'), true);

/* ================================================================== */
/* TEST 4 — No release date                                          */
/*                                                                    */
/* film:    release_date=null, budget=0, budget_inferred=0           */
/* sentiment: data_available=false                                   */
/* comps:   comps_found=0                                            */
/*                                                                    */
/* Trace:                                                             */
/*   days=null → base=low                                            */
/*   upgrades: all NO                                                 */
/*   downgrades: noBudget → try low→below_low → floor fires         */
/*   ceiling: days=null → no ceiling condition                       */
/*   floor: triggered (prevents going below low)                     */
/*   RESULT: low                                                      */
/* ================================================================== */
console.log('\n══════════════════════════════════════════════════');
console.log('  TEST 4 — No release date');
console.log('══════════════════════════════════════════════════');

const film4 = { ...dbFilm, release_date: null, budget: 0, budget_inferred: 0 };
const sent4 = { data_available: false };
const comp4 = { comps_found: 0 };

const r4 = computeConfidence(film4, sent4, comp4);
printResult('TEST 4', r4);
console.log('\n  Assertions:');
check('level',               r4.level,                          'low');
check('range_multiplier',    r4.range_multiplier,               0.60);
check('days_until_release',  r4.days_until_release,             null);
check('base',                r4.adjustments.base,               'low');
check('upgrades count',      r4.adjustments.upgrades.length,    0);
check('floor_applied',       r4.adjustments.floor_applied,      true);
check('ceiling_applied',     r4.adjustments.ceiling_applied,    false);
check('reason starts with',  r4.reason.startsWith('release date unknown'), true);

/* ------------------------------------------------------------------ */
/* Summary                                                            */
/* ------------------------------------------------------------------ */
console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed + failed} checks — ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
