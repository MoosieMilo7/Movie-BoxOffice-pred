import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { computeStructuralScore } from '../services/scoring/structural.js';

// Spider-Man: Brand New Day — data from tmdb.test.js run
const film = {
  tmdb_id: 969681,
  title: 'Spider-Man: Brand New Day',
  budget: 0,
  budget_inferred: 1,
  budget_source: 'franchise_inference',
  belongs_to_collection: JSON.stringify({
    id: 556,
    name: 'Spider-Man Collection',
  }),
  genres: JSON.stringify(['Action', 'Adventure', 'Science Fiction']),
  director: JSON.stringify({
    name: 'Destin Daniel Cretton',
    tmdb_person_id: 1144604,
  }),
  cast_top5: JSON.stringify([
    { name: 'Tom Holland',  tmdb_person_id: 1136406, order: 0 },
    { name: 'Zendaya',     tmdb_person_id: 505710,  order: 1 },
    { name: 'Sadie Sink',  tmdb_person_id: 1721767, order: 2 },
  ]),
  mpaa_rating: 'PG-13',
  production_companies: JSON.stringify([
    { name: 'Marvel Studios',    id: 420 },
    { name: 'Columbia Pictures', id: 5   },
  ]),
  market: 'hollywood',
  status: 'in_production',
};

console.log('\n══════════════════════════════════════════════════');
console.log('  Structural Score Test — Spider-Man: Brand New Day');
console.log('══════════════════════════════════════════════════\n');

const result = computeStructuralScore(film);

// Final score
console.log(`FINAL STRUCTURAL SCORE:  ${result.score}`);
console.log(`Major studio detected:   ${result.major_studio}\n`);

// Component breakdown
const c = result.components;
console.log('Component Breakdown:');
console.log('─'.repeat(52));
console.log(`  budget    ×0.30  score=${c.budget.score.toFixed(4)}  tier="${c.budget.tier}"  value=$${(c.budget.value/1e6).toFixed(1)}M`);
console.log(`  franchise ×0.25  score=${c.franchise.score.toFixed(4)}  label="${c.franchise.label}"`);
console.log(`  genre     ×0.20  score=${c.genre.score.toFixed(4)}  primary_genre="${c.genre.primary_genre}"`);
console.log(`  talent    ×0.15  score=${c.talent.score.toFixed(4)}  dir_found=${c.talent.director_found}  cast_found=${c.talent.cast_found}`);
console.log(`             └─ director_score=${c.talent.director_score.toFixed(4)}  cast_score=${c.talent.cast_score.toFixed(4)}`);
console.log(`  mpaa      ×0.10  score=${c.mpaa.score.toFixed(4)}  rating="${c.mpaa.rating}"`);

// Manual weighted sum audit
const weighted =
  c.budget.score    * 0.30 +
  c.franchise.score * 0.25 +
  c.genre.score     * 0.20 +
  c.talent.score    * 0.15 +
  c.mpaa.score      * 0.10;

console.log('─'.repeat(52));
console.log(`  Weighted sum (manual audit):  ${weighted.toFixed(6)}`);
console.log(`  Returned score:               ${result.score}`);
console.log('─'.repeat(52));

// Expectations
console.log('\nExpectations check:');
const checks = [
  ['budget_score',   c.budget.score,    0.65, 'inferred franchise → 0.65, major studio floor → 0.65 → no change'],
  ['franchise_score',c.franchise.score, 0.65, 'collection exists but no prior revenue in DB → franchise_unverified'],
  ['genre_score',    c.genre.score,     0.80, 'Action is highest at 0.80'],
  ['talent_score',   c.talent.score,    0.35, 'talent_scores table empty → defaults (0.35*0.40 + 0.35*0.60 = 0.35)'],
  ['mpaa_score',     c.mpaa.score,      0.85, 'PG-13 → 0.85'],
];

for (const [name, actual, expected, reason] of checks) {
  const ok = Math.abs(actual - expected) < 0.0001;
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(16)} expected=${expected}  got=${actual.toFixed(4)}  — ${reason}`);
}

const expectedFinal = 0.65*0.30 + 0.65*0.25 + 0.80*0.20 + 0.35*0.15 + 0.85*0.10;
const finalOk = Math.abs(result.score - expectedFinal) < 0.0001;
console.log(`  ${finalOk ? '✅' : '❌'} final_score       expected=${expectedFinal.toFixed(4)}  got=${result.score}`);

console.log('\n══════════════════════════════════════════════════\n');
