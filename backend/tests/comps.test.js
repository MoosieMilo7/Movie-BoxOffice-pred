import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { computeCompScore } from '../services/scoring/comps.js';

/* ------------------------------------------------------------------ */
/* Seed Spider-Man: Brand New Day                                     */
/* ------------------------------------------------------------------ */
db.prepare(`
  INSERT INTO films (
    tmdb_id, title, status, market, release_date,
    budget, budget_inferred, genres, belongs_to_collection,
    mpaa_rating, original_language
  ) VALUES (
    969681,
    'Spider-Man: Brand New Day',
    'in_production',
    'hollywood',
    '2026-07-29',
    0, 1,
    '["Action","Adventure","Science Fiction"]',
    '{"id":556,"name":"Spider-Man Collection"}',
    'PG-13',
    'en'
  )
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title                = excluded.title,
    status               = excluded.status,
    market               = excluded.market,
    release_date         = excluded.release_date,
    budget               = excluded.budget,
    budget_inferred      = excluded.budget_inferred,
    genres               = excluded.genres,
    belongs_to_collection= excluded.belongs_to_collection,
    mpaa_rating          = excluded.mpaa_rating,
    original_language    = excluded.original_language
`).run();

const film = db.prepare('SELECT * FROM films WHERE tmdb_id = 969681').get();

/* ------------------------------------------------------------------ */
/* Run computeCompScore                                               */
/* ------------------------------------------------------------------ */
console.log('\n══════════════════════════════════════════════════════════');
console.log('  Comps Test — Spider-Man: Brand New Day');
console.log('══════════════════════════════════════════════════════════');
console.log(`  film.id = ${film.id}  |  tmdb_id = ${film.tmdb_id}`);
console.log('  (Making real TMDB API calls — may take ~30s)\n');

const result = await computeCompScore(film);

/* ------------------------------------------------------------------ */
/* Print full result                                                  */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────');
console.log('  RESULT SUMMARY');
console.log('──────────────────────────────────────────────────────────');
console.log(`  comp_score:              ${result.score}`);
console.log(`  data_available:          ${result.data_available}`);
console.log(`  comps_found:             ${result.comps_found}`);
console.log(`  weighted_ow_origin_usd:  $${result.weighted_ow_origin_usd}M`);
console.log(`  weighted_ow_global_usd:  $${result.weighted_ow_global_usd}M`);

console.log('\n──────────────────────────────────────────────────────────');
console.log('  SELECTED COMP FILMS');
console.log('──────────────────────────────────────────────────────────');

result.comps_used.forEach((c, i) => {
  console.log(`\n  [${i + 1}] ${c.title} (${c.release_date?.slice(0, 4) ?? '?'})`);
  console.log(`       similarity_score:    ${c.similarity_score}`);
  console.log(`       actual_ow_origin:    $${c.actual_ow_origin_usd}M`);
  console.log(`       actual_ow_global:    $${c.actual_ow_global_usd}M`);
  console.log(`       match_reasons:       ${c.match_reasons.join(' | ')}`);
});

/* ------------------------------------------------------------------ */
/* Inspect what's now in comp_anchors                                 */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────');
console.log('  DB AUDIT: comp_anchors rows');
console.log('──────────────────────────────────────────────────────────');
const anchors = db.prepare(`
  SELECT ca.similarity_score, ca.comp_actual_ow_origin, ca.comp_actual_ow_global,
         f.title, f.revenue
  FROM comp_anchors ca
  JOIN films f ON ca.comp_film_id = f.id
  WHERE ca.upcoming_film_id = ?
  ORDER BY ca.similarity_score DESC
`).all(film.id);

anchors.forEach((r) => {
  console.log(`  ${r.title.padEnd(40)} sim=${r.similarity_score.toFixed(4)}  ow_global=$${r.comp_actual_ow_global}M  revenue=$${(r.revenue/1e6).toFixed(0)}M`);
});

console.log('\n══════════════════════════════════════════════════════════');
console.log('  DB preserved — query comp_anchors to inspect further');
console.log('══════════════════════════════════════════════════════════\n');
