import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import db from '../db/database.js';
import { generatePrediction } from '../services/predictor.js';

const film = db.prepare('SELECT * FROM films WHERE tmdb_id = 969681').get();

if (!film) {
  console.error('Spider-Man: Brand New Day not found in DB — run comps.test.js first');
  process.exit(1);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Predictor Test — Spider-Man: Brand New Day');
console.log(`  film.id=${film.id}  tmdb_id=${film.tmdb_id}  market=${film.market}`);
console.log('══════════════════════════════════════════════════════════════');

const result = await generatePrediction(film);

/* ------------------------------------------------------------------ */
/* Opening weekend                                                    */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  OPENING WEEKEND PROJECTION');
console.log('──────────────────────────────────────────────────────────────');

const ow = result.prediction.opening_weekend;
console.log(`  Global OW:    $${ow.global.low_usd}M – $${ow.global.mid_usd}M – $${ow.global.high_usd}M`);
console.log(`  Origin (${ow.origin_market.country}, ${ow.origin_market.currency_code}):`);
console.log(`    USD:   $${ow.origin_market.low_usd}M – $${ow.origin_market.mid_usd}M – $${ow.origin_market.high_usd}M`);
console.log(`    Local: ${ow.origin_market.currency_symbol}${ow.origin_market.low_local.toLocaleString()} – ${ow.origin_market.currency_symbol}${ow.origin_market.high_local.toLocaleString()}`);
console.log(`  Confidence:   ${result.prediction.confidence}  (range ±${result.prediction.opening_weekend.global.mid_usd > 0 ? ((ow.global.high_usd - ow.global.mid_usd) / ow.global.mid_usd * 100).toFixed(0) : '?'}%)`);
console.log(`  Days out:     ${result.prediction.days_until_release}`);

/* ------------------------------------------------------------------ */
/* Score breakdown                                                    */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  SCORE BREAKDOWN');
console.log('──────────────────────────────────────────────────────────────');

const sb = result.prediction.score_breakdown;
const rows = [
  ['structural', sb.structural, '×0.25'],
  ['sentiment',  sb.sentiment,  '×0.30'],
  ['momentum',   sb.momentum,   '×0.20'],
  ['market',     sb.market,     '×0.10'],
  ['comps',      sb.comps,      '×0.15'],
];
rows.forEach(([name, score, wt]) =>
  console.log(`  ${name.padEnd(12)} ${wt}   ${score.toFixed(4)}`)
);
console.log(`  ${'─'.repeat(30)}`);
console.log(`  ${'final'.padEnd(12)}        ${sb.final}`);

/* ------------------------------------------------------------------ */
/* Key drivers + risk factors                                         */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  KEY DRIVERS');
console.log('──────────────────────────────────────────────────────────────');
result.prediction.key_drivers.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));

console.log('\n  RISK FACTORS');
console.log('──────────────────────────────────────────────────────────────');
result.prediction.risk_factors.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

/* ------------------------------------------------------------------ */
/* Comp films used                                                    */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  COMP FILMS USED IN PROJECTION');
console.log('──────────────────────────────────────────────────────────────');
result.prediction.comp_films.forEach((c, i) =>
  console.log(`  ${i + 1}. ${c.title}  →  $${c.actual_ow_global_usd}M global OW`)
);

/* ------------------------------------------------------------------ */
/* Analyst report                                                     */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  CLAUDE ANALYST REPORT');
console.log('──────────────────────────────────────────────────────────────');
if (result.prediction.analyst_report) {
  console.log('\n  ' + result.prediction.analyst_report.split('\n').join('\n  '));
} else {
  console.log('  (report unavailable)');
}

/* ------------------------------------------------------------------ */
/* DB verification                                                    */
/* ------------------------------------------------------------------ */
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  DB VERIFICATION — stored prediction row');
console.log('──────────────────────────────────────────────────────────────');

const stored = db.prepare(`
  SELECT id, generated_at, confidence, final_score,
         global_ow_low, global_ow_mid, global_ow_high,
         origin_ow_mid, origin_country, origin_currency,
         methodology_version, analyst_report
  FROM predictions
  WHERE film_id = ?
  ORDER BY generated_at DESC LIMIT 1
`).get(film.id);

if (stored) {
  console.log(`  id:                  ${stored.id}`);
  console.log(`  generated_at:        ${stored.generated_at}`);
  console.log(`  methodology_version: ${stored.methodology_version}`);
  console.log(`  confidence:          ${stored.confidence}`);
  console.log(`  final_score:         ${stored.final_score}`);
  console.log(`  global_ow_mid:       $${stored.global_ow_mid}M`);
  console.log(`  global_ow_low:       $${stored.global_ow_low}M`);
  console.log(`  global_ow_high:      $${stored.global_ow_high}M`);
  console.log(`  origin_ow_mid:       $${stored.origin_ow_mid}M (${stored.origin_country}, ${stored.origin_currency})`);
  console.log(`  analyst_report:      ${stored.analyst_report ? '✓ stored (' + stored.analyst_report.length + ' chars)' : '✗ null'}`);
} else {
  console.log('  ✗ No row found — INSERT failed');
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  sentiment_pending: ${result.sentiment_pending}`);
console.log('══════════════════════════════════════════════════════════════\n');
