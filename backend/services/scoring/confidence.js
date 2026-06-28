/**
 * confidence.js — How much should we trust this prediction?
 *
 * Produces a confidence level, a range multiplier (controls low-high band width),
 * and a human-readable reason string.
 *
 * Logic flow:
 *   1. Base confidence from days until release
 *   2. Upgrades: budget known, sentiment scraped, strong comps (max +2 tiers)
 *   3. Downgrades: no budget, releasing soon with no sentiment
 *   4. Ceiling: can't be very_high/high too far in advance
 *   5. Floor: never below "low"
 */

const TIERS  = ['low', 'medium', 'high', 'very_high']; // indices 0–3
const RANGES = { very_high: 0.15, high: 0.25, medium: 0.40, low: 0.60 };

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysUntil(releaseDate) {
  if (!releaseDate) return null;
  return Math.ceil((new Date(releaseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function baseFromDays(days) {
  if (days === null) return 'low';
  if (days > 180)   return 'low';
  if (days > 90)    return 'low';
  if (days > 30)    return 'medium';
  if (days > 7)     return 'high';
  return 'very_high';
}

function timeReason(days) {
  if (days === null) return 'release date unknown';
  if (days > 180)   return 'release is over 6 months away';
  if (days > 90)    return 'release is 3-6 months away';
  if (days > 30)    return 'release is 1-3 months away';
  if (days > 7)     return 'release is within a month';
  return 'release is imminent';
}

/* ================================================================== */
/* computeConfidence(film, sentimentResult, compResult)               */
/* ================================================================== */

export function computeConfidence(film, sentimentResult, compResult) {
  const days = daysUntil(film.release_date ?? null);
  const base = baseFromDays(days);

  let tier         = TIERS.indexOf(base);
  let upgradeCount = 0;
  let floorApplied = false;
  let ceilingApplied = false;
  const upgrades   = [];
  const downgrades = [];

  /* ── Step 2: upgrades (max 2 tiers above base) ──────────────────── */
  const hasBudget = (film.budget > 0) || !!(film.budget_inferred);
  if (hasBudget && upgradeCount < 2) {
    upgrades.push(film.budget > 0 ? 'budget known' : 'budget inferred from franchise');
    tier++;
    upgradeCount++;
  }

  if (sentimentResult.data_available && upgradeCount < 2) {
    upgrades.push('social data available');
    tier++;
    upgradeCount++;
  }

  if (compResult.comps_found >= 3 && upgradeCount < 2) {
    upgrades.push(`strong comp anchor (${compResult.comps_found} films)`);
    tier++;
    upgradeCount++;
  }

  // Hard cap at tier 3 after upgrades (belt-and-suspenders for the +2 rule).
  tier = Math.min(tier, 3);

  /* ── Step 3: downgrades ─────────────────────────────────────────── */
  const noBudget = !(film.budget > 0) && !film.budget_inferred;
  if (noBudget) {
    downgrades.push('budget unknown');
    if (tier > 0) tier--;
    else          floorApplied = true;
  }

  const sentMissingSoon =
    !sentimentResult.data_available &&
    days !== null &&
    days < 30;
  if (sentMissingSoon) {
    downgrades.push('releasing soon without social data');
    if (tier > 0) tier--;
    else          floorApplied = true;
  }

  /* ── Step 4: ceiling ────────────────────────────────────────────── */
  let maxTier = 3;
  if (days !== null && days > 90)      maxTier = 1; // max "medium"
  else if (days !== null && days > 30) maxTier = 2; // max "high"

  if (tier > maxTier) {
    tier = maxTier;
    ceilingApplied = true;
  }

  /* ── Step 5: floor (after ceiling) ─────────────────────────────── */
  if (tier < 0) {
    tier = 0;
    floorApplied = true;
  }

  const level = TIERS[tier];

  /* ── Reason string ──────────────────────────────────────────────── */
  const parts = [timeReason(days)];

  if ((film.budget ?? 0) > 0)   parts.push('budget confirmed');
  else if (film.budget_inferred) parts.push('budget estimated from franchise');
  else                           parts.push('budget unknown');

  if (sentimentResult.data_available) parts.push('social data available');
  else                                parts.push('awaiting social data');

  const n = compResult.comps_found;
  if (n >= 3)      parts.push(`strong comp anchor (${n} films)`);
  else if (n >= 1) parts.push(`weak comp anchor (${n} film${n > 1 ? 's' : ''})`);
  else             parts.push('no comp anchor');

  return {
    level,
    range_multiplier:   RANGES[level],
    days_until_release: days,
    reason:             parts.join(', '),
    adjustments: {
      base,
      upgrades,
      downgrades,
      ceiling_applied: ceilingApplied,
      floor_applied:   floorApplied,
    },
  };
}
