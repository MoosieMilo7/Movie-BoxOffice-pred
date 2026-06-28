/**
 * backtest.js — Model v1.0 retrospective accuracy test.
 *
 * Uses the production scoring engine directly (scoreUpcomingFilm).
 * Forces the UPCOMING pipeline on every film regardless of release status,
 * so we measure the budget-anchor formula against known actuals.
 *
 * Comparison unit: USD millions (predicted) vs actual_ow_global / 1_000_000.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dir = path.dirname(fileURLToPath(import.meta.url));
// Load .env from the project root (one level up from backtest/).
dotenv.config({ path: path.join(__dir, '../.env') });

// Production modules — no separate model, same code path as the server.
import { scoreUpcomingFilm } from '../backend/services/predictor.js';
import { getMovieDetails, mapToFilmRow } from '../backend/services/tmdb.js';
import { initRates } from '../backend/services/exchangeRates.js';

const TEST_FILMS = JSON.parse(readFileSync(path.join(__dir, 'test_films.json'), 'utf8'));
const RESULTS_DIR = path.join(__dir, 'results');

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function fM(millions) {
  if (Math.abs(millions) >= 1000) return `$${(millions / 1000).toFixed(2)}B`;
  if (Math.abs(millions) >= 1)    return `$${millions.toFixed(1)}M`;
  return `$${(millions * 1000).toFixed(0)}K`;
}

function pad(val, len, right = false) {
  const s = String(val).slice(0, len);
  return right ? s.padStart(len) : s.padEnd(len);
}

const COL = {
  n:       3,
  title:   35,
  market:  10,
  tier:    8,
  pred:    22,
  actual:  11,
  mape:    8,
  dir:     10,
};

const DIVIDER =
  '─'.repeat(COL.n + 2) +
  '─'.repeat(COL.title + 2) +
  '─'.repeat(COL.market + 2) +
  '─'.repeat(COL.tier + 2) +
  '─'.repeat(COL.pred + 2) +
  '─'.repeat(COL.actual + 2) +
  '─'.repeat(COL.mape + 2) +
  '─'.repeat(COL.dir);

function printHeader() {
  console.log('');
  console.log(
    pad('#',     COL.n,      true)  + '  ' +
    pad('Title', COL.title)         + '  ' +
    pad('Market', COL.market)       + '  ' +
    pad('Tier',   COL.tier)         + '  ' +
    pad('Prediction ($M)', COL.pred)+ '  ' +
    pad('Actual',  COL.actual,true) + '  ' +
    pad('MAPE',   COL.mape,  true)  + '  ' +
    'Result'
  );
  console.log(DIVIDER);
}

function printRow(n, result) {
  const { title, market, budget_tier, pred_range, actual_m, mape, direction } = result;
  const dirSymbol = direction === 'hit' ? '✓ HIT' : direction === 'underestimate' ? '↓ UNDER' : '↑ OVER';
  console.log(
    pad(n,          COL.n,      true)  + '  ' +
    pad(title,      COL.title)         + '  ' +
    pad(market,     COL.market)        + '  ' +
    pad(budget_tier.toUpperCase(), COL.tier) + '  ' +
    pad(pred_range, COL.pred)          + '  ' +
    pad(fM(actual_m), COL.actual, true)+ '  ' +
    pad(mape.toFixed(1) + '%', COL.mape, true) + '  ' +
    dirSymbol
  );
}

/* ------------------------------------------------------------------ */
/* Stats aggregation                                                  */
/* ------------------------------------------------------------------ */

function groupBy(results, key) {
  const groups = {};
  for (const r of results) {
    const k = r[key] ?? 'unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  return groups;
}

function statsFor(group) {
  if (!group || group.length === 0) return { mape: null, hits: 0, n: 0 };
  const mape = group.reduce((s, r) => s + r.mape, 0) / group.length;
  const hits = group.filter((r) => r.direction === 'hit').length;
  return { mape, hits, n: group.length };
}

function printStats(results) {
  const overall = statsFor(results);
  const byMarket = groupBy(results, 'market');
  const byTier = groupBy(results, 'budget_tier');
  const byStrategy = groupBy(results, 'release_strategy_bucket');

  const overCount = results.filter((r) => r.direction === 'overestimate').length;
  const underCount = results.filter((r) => r.direction === 'underestimate').length;
  const hitCount = results.filter((r) => r.direction === 'hit').length;

  const sorted = [...results].sort((a, b) => a.mape - b.mape);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const verdict =
    overall.mape < 40 && overall.hits / overall.n > 0.5
      ? 'READY TO DEPLOY'
      : 'NEEDS TUNING';

  const marketOrder = [
    ['hollywood', 'Hollywood'],
    ['korean',    'Korean   '],
    ['bollywood', 'Bollywood'],
    ['japanese',  'Japanese '],
    ['european',  'European '],
  ];

  const tierOrder = ['tentpole', 'major', 'mid', 'indie', 'unknown'];

  console.log('');
  console.log('═'.repeat(65));
  console.log(`BACKTEST RESULTS — MODEL V${process.env.MODEL_VERSION || '1.0'}`);
  console.log('═'.repeat(65));
  console.log(`Overall hit rate:     ${overall.hits}/${overall.n} (${((overall.hits / overall.n) * 100).toFixed(0)}%)`);
  console.log(`Overall MAPE:         ${overall.mape.toFixed(1)}%`);
  console.log('');
  console.log('By market:');
  for (const [key, label] of marketOrder) {
    const s = statsFor(byMarket[key]);
    if (s.n === 0) continue;
    console.log(`  ${label} (${s.n}):  ${s.mape != null ? s.mape.toFixed(1) : 'n/a'}% MAPE | ${s.hits}/${s.n} hits`);
  }
  console.log('');
  console.log('By budget tier:');
  for (const tier of tierOrder) {
    const s = statsFor(byTier[tier]);
    if (s.n === 0) continue;
    console.log(`  ${tier.padEnd(10)}(${s.n}):  ${s.mape != null ? s.mape.toFixed(1) : 'n/a'}% MAPE`);
  }
  // Also group by DETECTED release strategy (not the test-data bucket).
  const byDetected = groupBy(results, 'detected_strategy');
  console.log('');
  console.log('By release strategy (test data label):');
  const wideStats = statsFor(byStrategy['wide']);
  const limitedStats = statsFor(byStrategy['limited']);
  if (wideStats.n)    console.log(`  Wide    (${wideStats.n}):   ${wideStats.mape.toFixed(1)}% MAPE`);
  if (limitedStats.n) console.log(`  Limited (${limitedStats.n}):   ${limitedStats.mape.toFixed(1)}% MAPE`);
  console.log('');
  console.log('By DETECTED release strategy (model output):');
  for (const strat of ['wide', 'platform', 'limited', 'unknown']) {
    const s = statsFor(byDetected[strat]);
    if (s.n === 0) continue;
    const scalar = strat === 'wide' ? '×1.00' : strat === 'platform' ? '×0.25' : strat === 'limited' ? '×0.03' : '×1.00';
    console.log(`  ${strat.padEnd(9)}${scalar}  (${s.n}):  ${s.mape.toFixed(1)}% MAPE | ${s.hits}/${s.n} hits`);
  }
  console.log('');
  console.log(
    `Systematic bias:      Overestimating ${((overCount / overall.n) * 100).toFixed(0)}%` +
    ` | Underestimating ${((underCount / overall.n) * 100).toFixed(0)}%` +
    ` | On target ${((hitCount / overall.n) * 100).toFixed(0)}%`
  );
  console.log(`Best prediction:      ${best.title} (${best.mape.toFixed(1)}% MAPE)`);
  console.log(`Worst prediction:     ${worst.title} (${worst.mape.toFixed(1)}% MAPE)`);
  console.log(`Model verdict:        ${verdict}`);
  console.log('═'.repeat(65));
  console.log('');

  return verdict;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

// Retry a TMDB fetch up to 4 times with exponential backoff.
async function fetchWithRetry(tmdbId, retries = 4, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await getMovieDetails(tmdbId);
    } catch (err) {
      const is5xx = err.message.includes('502') || err.message.includes('503') || err.message.includes('500');
      if (is5xx && attempt < retries) {
        const wait = baseDelayMs * attempt;
        process.stdout.write(`  [retry ${attempt}/${retries - 1} in ${wait / 1000}s] `);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

const INTER_REQUEST_DELAY_MS = 400;

async function scoreFilmForBacktest(testEntry) {
  const details = await fetchWithRetry(testEntry.tmdb_id);
  const row = mapToFilmRow(details);

  // Force UPCOMING scoring pipeline regardless of release status.
  const scores = scoreUpcomingFilm(
    { ...row, id: testEntry.tmdb_id },
    {
      sentiment: null,
      previousSentiment: null,
      collection: row.belongs_to_collection,
      originalLanguage: row.original_language,
    }
  );

  const ow = scores.opening_weekend;
  const low_usd  = ow.global.low_usd;
  const high_usd = ow.global.high_usd;
  const pred_mid = (low_usd + high_usd) / 2;

  const actual_m = testEntry.actual_ow_global / 1_000_000; // convert to millions
  const mape = Math.abs(actual_m - pred_mid) / actual_m * 100;
  const direction =
    actual_m > high_usd ? 'underestimate' :
    actual_m < low_usd  ? 'overestimate'  : 'hit';

  const strategy = testEntry.release_strategy;
  const strategy_bucket = strategy === 'wide' || strategy.startsWith('wide_') ? 'wide' : 'limited';

  return {
    tmdb_id:               testEntry.tmdb_id,
    title:                 details.title || testEntry.title,
    market:                testEntry.market,
    budget_tier:           scores.budget_tier,
    budget:                row.budget,
    budget_inferred:       row.budget_inferred,
    release_strategy:      testEntry.release_strategy,
    release_strategy_bucket: strategy_bucket,
    detected_strategy:     scores.release_strategy,
    release_scalar:        scores.release_scalar,
    release_inferred:      scores.release_inferred,
    release_strategy_multiplier: scores.release_strategy_multiplier,
    market_adjustment:     scores.market_adjustment,
    sentiment_score:       scores.sentiment_score,
    franchise:             scores.franchise_multiplier > 1,
    pred_low:              low_usd,
    pred_high:             high_usd,
    pred_mid,
    actual_m,
    mape,
    direction,
    pred_range:            `${fM(low_usd)} – ${fM(high_usd)}`,
    key_drivers:           scores.key_drivers,
    risk_factors:          scores.risk_factors,
  };
}

async function main() {
  console.log('');
  console.log('═'.repeat(65));
  console.log('BOXOFFICE PREDICTOR — BACKTEST v1.0');
  console.log(`Testing ${TEST_FILMS.length} films across 5 markets`);
  console.log('Scoring engine: production predictor.js (UPCOMING mode forced)');
  console.log('No social sentiment data (all Apify weight redistributed)');
  console.log('═'.repeat(65));

  await initRates();
  printHeader();

  mkdirSync(RESULTS_DIR, { recursive: true });
  const allResults = [];
  const errors = [];

  for (let i = 0; i < TEST_FILMS.length; i++) {
    const entry = TEST_FILMS[i];
    if (i > 0) await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
    try {
      const result = await scoreFilmForBacktest(entry);
      allResults.push(result);
      printRow(i + 1, result);
    } catch (err) {
      errors.push({ tmdb_id: entry.tmdb_id, title: entry.title, error: err.message });
      console.log(
        pad(i + 1, COL.n, true) + '  ' +
        pad(entry.title, COL.title) + '  ' +
        pad(entry.market, COL.market) + '  ' +
        pad('ERROR', COL.tier) + '  ' +
        err.message.slice(0, 40)
      );
    }
  }

  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} film(s) failed to fetch from TMDB.`);
  }

  const verdict = printStats(allResults);

  const output = {
    run_at:    new Date().toISOString(),
    model:     'v1.0',
    engine:    'production predictor.js (UPCOMING mode)',
    n_films:   TEST_FILMS.length,
    n_scored:  allResults.length,
    n_errors:  errors.length,
    verdict,
    overall: {
      mape:     allResults.reduce((s, r) => s + r.mape, 0) / allResults.length,
      hit_rate: allResults.filter((r) => r.direction === 'hit').length / allResults.length,
    },
    films: allResults,
    errors,
  };

  const outPath = path.join(RESULTS_DIR, 'backtest_v1.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Full results saved → ${outPath}`);
}

main().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
