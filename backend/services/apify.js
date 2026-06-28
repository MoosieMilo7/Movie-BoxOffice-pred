/**
 * apify.js — Social sentiment pipeline (pure volume-based scoring)
 *
 * Claude is NOT called here. Sentiment = deterministic math on two signals:
 *   view_score    — YouTube trailer view count (weight 0.70)
 *   mention_score — Reddit post + comment volume  (weight 0.30)
 *
 * Claude API calls are reserved exclusively for the analyst report
 * in predictor.js where natural language generation is actually needed.
 *
 * Data sources:
 *   1. Reddit direct JSON API  — mention volume (posts + their comments)
 *   2. YouTube via Apify       — trailer view count (streamers/youtube-scraper)
 */
import { ApifyClient } from 'apify-client';
import dotenv           from 'dotenv';
import db               from '../db/database.js';

dotenv.config();

const apify = new ApifyClient({ token: process.env.APIFY_API_KEY });

/* ------------------------------------------------------------------ */
/* scoreSentiment — pure math, zero LLM cost                         */
/* ------------------------------------------------------------------ */

function scoreSentiment(trailer_views, mention_volume) {
  // View count score (0-5)
  let view_score;
  if      (trailer_views >= 100_000_000) view_score = 5;
  else if (trailer_views >= 50_000_000)  view_score = 4;
  else if (trailer_views >= 20_000_000)  view_score = 3;
  else if (trailer_views >= 5_000_000)   view_score = 2;
  else if (trailer_views >= 1_000_000)   view_score = 1;
  else                                   view_score = 0;

  // Mention volume score (0-5)
  let mention_score;
  if      (mention_volume >= 500_000) mention_score = 5;
  else if (mention_volume >= 100_000) mention_score = 4;
  else if (mention_volume >= 25_000)  mention_score = 3;
  else if (mention_volume >= 5_000)   mention_score = 2;
  else if (mention_volume >= 1_000)   mention_score = 1;
  else                                mention_score = 0;

  const raw   = view_score * 0.70 + mention_score * 0.30;
  const score = Math.min(5, Math.max(0, Math.round(raw)));

  const LABELS = ['dead', 'cold', 'warm', 'hot', 'very_hot', 'explosive'];
  const viewM  = (trailer_views / 1_000_000).toFixed(1);

  return {
    score,
    label:      LABELS[score],
    one_line:   `${viewM}M trailer views · ${mention_volume.toLocaleString()} total mentions`,
    view_score,
    mention_score,
  };
}

/* ------------------------------------------------------------------ */
/* Reddit — mention volume only (post count + comment counts)        */
/* ------------------------------------------------------------------ */

const REDDIT_HEADERS = { 'User-Agent': 'BoxOfficePredictor/1.0' };

async function fetchRedditSearch(url) {
  const res = await fetch(url, { headers: REDDIT_HEADERS });
  if (res.status === 429) { console.log('[REDDIT] Rate limited, skipping'); return []; }
  if (!res.ok)            { console.log(`[REDDIT] Failed: ${res.status}`);  return []; }
  return (await res.json())?.data?.children?.map((c) => c.data) ?? [];
}

async function fetchRedditMentionVolume(query, filmTitle) {
  const globalUrl =
    `https://www.reddit.com/search.json` +
    `?q=${encodeURIComponent(query)}&sort=relevance&limit=100&type=link`;
  const moviesUrl =
    `https://www.reddit.com/r/movies/search.json` +
    `?q=${encodeURIComponent(filmTitle)}&sort=top&limit=50&restrict_sr=1`;

  const [g, m] = await Promise.all([
    fetchRedditSearch(globalUrl),
    fetchRedditSearch(moviesUrl),
  ]);

  // Deduplicate by permalink, count posts + comments.
  const seen = new Set();
  let post_count = 0;
  let total_volume = 0;
  for (const p of [...g, ...m]) {
    const key = p.permalink || p.title;
    if (!seen.has(key)) {
      seen.add(key);
      post_count++;
      total_volume += 1 + (p.num_comments || 0);
    }
  }
  return { post_count, total_volume };
}

/* ------------------------------------------------------------------ */
/* YouTube — view count via Apify (best-effort, free tier)           */
/* ------------------------------------------------------------------ */

async function fetchYoutubeViewCount(trailerUrl) {
  if (!trailerUrl) return 0;
  try {
    // Attempt 1: with comments (may fail dataset validation for this actor).
    let run     = await apify.actor('streamers/youtube-scraper').call({
      startUrls: [{ url: trailerUrl }], maxResults: 1, maxComments: 200,
    });
    let dataset = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    let item    = (dataset.items ?? []).find((i) => !i.error) ?? null;

    // Fallback: view-count-only run when comment run returns nothing.
    if (!item || (!item.viewCount && !item.views)) {
      console.log('[APIFY] YouTube comment run empty — retrying for view count only');
      run     = await apify.actor('streamers/youtube-scraper').call({
        startUrls: [{ url: trailerUrl }], maxResults: 1, maxComments: 0,
      });
      dataset = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
      item    = (dataset.items ?? []).find((i) => !i.error) ?? {};
    }

    return item.viewCount ?? item.views ?? 0;
  } catch {
    return 0;
  }
}

/* ================================================================== */
/* scrapeFilmSentiment(film)                                          */
/* ================================================================== */

export async function scrapeFilmSentiment(film) {
  const releaseYear = film.release_date
    ? new Date(film.release_date).getFullYear()
    : new Date().getFullYear();
  const searchQuery = `${film.title} ${releaseYear} movie`;
  const start       = Date.now();

  /* ── Reddit mention volume ──────────────────────────────────────── */
  let reddit_post_count  = 0;
  let mention_volume     = 0;
  try {
    console.log(`[APIFY] Reddit mention fetch: "${searchQuery}"`);
    const r = await fetchRedditMentionVolume(searchQuery, film.title);
    reddit_post_count = r.post_count;
    mention_volume    = r.total_volume;
    console.log(`[APIFY] Reddit: ${reddit_post_count} posts, ${mention_volume.toLocaleString()} mention volume`);
  } catch (err) {
    console.error(`[APIFY] Reddit failed: ${err.message}`);
  }

  /* ── YouTube view count ─────────────────────────────────────────── */
  let trailer_view_count = 0;
  if (film.trailer_url) {
    console.log(`[APIFY] YouTube view count: ${film.trailer_url}`);
    trailer_view_count = await fetchYoutubeViewCount(film.trailer_url);
    console.log(`[APIFY] YouTube: ${trailer_view_count.toLocaleString()} views`);
  }

  /* ── Score ──────────────────────────────────────────────────────── */
  const sentiment = scoreSentiment(trailer_view_count, mention_volume);
  const elapsed   = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[APIFY] Score: ${sentiment.score}/5 (${sentiment.label}) ` +
    `[view=${sentiment.view_score} mention=${sentiment.mention_score}] in ${elapsed}s`
  );

  /* ── Buzz velocity ───────────────────────────────────────────────── */
  const previousSnapshot = db.prepare(
    'SELECT * FROM sentiment_snapshots WHERE film_id = ? ORDER BY scraped_at DESC LIMIT 1'
  ).get(film.id);

  const prev_mentions    = previousSnapshot?.raw_mention_count ?? 0;
  const mention_velocity = prev_mentions > 0
    ? Math.round(((mention_volume - prev_mentions) / prev_mentions) * 10000) / 100
    : 0;

  /* ── Store snapshot ──────────────────────────────────────────────── */
  const info = db.prepare(`
    INSERT INTO sentiment_snapshots (
      film_id, scraped_at,
      sentiment_score, sentiment_label, sentiment_one_line,
      trailer_view_count, raw_mention_count,
      previous_mention_count, mention_velocity,
      snapshot_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    film.id,
    new Date().toISOString(),
    sentiment.score,
    sentiment.label,
    sentiment.one_line,
    trailer_view_count,
    mention_volume,
    prev_mentions,
    mention_velocity,
    JSON.stringify({
      reddit_post_count,
      mention_volume,
      trailer_view_count,
      view_score:    sentiment.view_score,
      mention_score: sentiment.mention_score,
      elapsed_secs:  parseFloat(elapsed),
    })
  );

  console.log(`[APIFY] Snapshot stored — id: ${info.lastInsertRowid}`);

  return {
    sentiment_score:    sentiment.score,
    sentiment_label:    sentiment.label,
    sentiment_one_line: sentiment.one_line,
    trailer_view_count,
    raw_mention_count:  mention_volume,
    mention_velocity,
    snapshot_id:        info.lastInsertRowid,
  };
}
