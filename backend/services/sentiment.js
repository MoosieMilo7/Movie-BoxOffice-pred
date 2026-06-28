// Deterministic sentiment scoring over scraped comment text (VADER-style via `sentiment`).
import Sentiment from 'sentiment';

const analyzer = new Sentiment();

// Score a single comment to a 0-1 value. The `sentiment` library returns a
// `comparative` score roughly in [-5, 5]; we squash it to [0, 1].
function scoreComment(text) {
  if (!text || typeof text !== 'string') return 0.5;
  const { comparative } = analyzer.analyze(text);
  // Clamp comparative to [-2, 2] then map linearly to [0, 1].
  const clamped = Math.max(-2, Math.min(2, comparative));
  return (clamped + 2) / 4;
}

// Average the sentiment of an array of comment strings, normalized to 0-1.
// Returns null when there is nothing to score (caller redistributes weight).
export function scoreComments(comments = []) {
  const texts = comments.filter((c) => typeof c === 'string' && c.trim().length > 0);
  if (texts.length === 0) return null;
  const total = texts.reduce((sum, t) => sum + scoreComment(t), 0);
  return total / texts.length;
}

// Combine raw Apify scrape output into a single composite_apify_score (0-1).
// Weighs YouTube comment sentiment most heavily, with a small volume bonus.
export function computeCompositeScore(rawData) {
  if (!rawData) return null;

  const youtubeComments = rawData.youtube?.comments || [];
  const redditTexts = rawData.reddit?.texts || [];
  const allComments = [...youtubeComments, ...redditTexts];

  const sentimentAvg = scoreComments(allComments); // 0-1 or null
  if (sentimentAvg === null) return null;

  // Volume signal: more total mentions => slightly higher confidence in buzz.
  const totalMentions =
    (rawData.reddit?.mentions || 0) +
    (rawData.youtube?.commentCount || youtubeComments.length || 0) +
    (rawData.twitter?.mentions || 0);
  const volumeBoost = Math.min(0.15, totalMentions / 100000); // capped at +0.15

  const composite = Math.max(0, Math.min(1, sentimentAvg * 0.85 + volumeBoost));
  return composite;
}

export { scoreComment };
