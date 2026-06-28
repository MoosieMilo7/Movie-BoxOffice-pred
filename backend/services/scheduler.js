/**
 * scheduler.js — Cron jobs for automatic sentiment refresh.
 *
 * Schedule (all times UTC):
 *   Every 6h  — upcoming films releasing within 30 days
 *   Weekly Su  — upcoming films 30–180 days out
 *   Monthly 1st — upcoming films > 180 days out
 *   Never       — released films (they use actual revenue data now)
 */
import cron from 'node-cron';
import db   from '../db/database.js';
import { scrapeFilmSentiment } from './apify.js';
import { generatePrediction }  from './predictor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function getUpcomingFilms() {
  return db.prepare(`
    SELECT * FROM films
    WHERE status IN ('upcoming','in_production','fresh_release')
    ORDER BY release_date ASC
  `).all();
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return Math.ceil((new Date(dateStr) - Date.now()) / DAY_MS);
}

async function scrapeAndPredict(film) {
  try {
    console.log(`[SCHEDULER] Scraping "${film.title}"...`);
    await scrapeFilmSentiment(film);
    await generatePrediction(film);
    db.prepare('UPDATE films SET last_apify_sync = ? WHERE id = ?')
      .run(new Date().toISOString(), film.id);
    console.log(`[SCHEDULER] ✅ "${film.title}" updated`);
  } catch (err) {
    console.error(`[SCHEDULER] ❌ "${film.title}": ${err.message}`);
  }
}

async function scrapeGroup(label, films) {
  console.log(`[SCHEDULER] ${label}: ${films.length} film(s)`);
  for (const film of films) {
    await scrapeAndPredict(film);
    await new Promise(r => setTimeout(r, 500)); // rate-limit between calls
  }
}

export function startScheduler() {
  console.log('[SCHEDULER] Registering cron jobs...');

  // Every 6 hours — films releasing within 30 days
  cron.schedule('0 */6 * * *', async () => {
    const films = getUpcomingFilms().filter(f => {
      const d = daysUntil(f.release_date);
      return d >= 0 && d <= 30;
    });
    await scrapeGroup('6h scrape (≤30 days)', films);
  });

  // Weekly Sunday 03:00 — films 30–180 days out
  cron.schedule('0 3 * * 0', async () => {
    const films = getUpcomingFilms().filter(f => {
      const d = daysUntil(f.release_date);
      return d > 30 && d <= 180;
    });
    await scrapeGroup('Weekly scrape (30–180 days)', films);
  });

  // Monthly 1st at 04:00 — films > 180 days out
  cron.schedule('0 4 1 * *', async () => {
    const films = getUpcomingFilms().filter(f => daysUntil(f.release_date) > 180);
    await scrapeGroup('Monthly scrape (>180 days)', films);
  });

  console.log('[SCHEDULER] ✅ Jobs registered (6h / weekly / monthly)');
}

/**
 * Run a one-time immediate scrape of all upcoming films.
 * Respects a staleness threshold so recently-scraped films are skipped.
 * @param {number} staleHours — skip films scraped more recently than this
 */
export async function runNow(staleHours = 0) {
  const films = getUpcomingFilms();
  const now   = Date.now();
  const toScrape = staleHours === 0
    ? films
    : films.filter(f => {
        if (!f.last_apify_sync) return true;
        const ageH = (now - new Date(f.last_apify_sync).getTime()) / 3_600_000;
        return ageH >= staleHours;
      });

  console.log(`[SCHEDULER] runNow: ${toScrape.length}/${films.length} films need scraping`);
  await scrapeGroup('on-demand scrape', toScrape);
}
