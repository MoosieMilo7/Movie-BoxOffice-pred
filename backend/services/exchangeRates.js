// Live exchange rate fetcher (exchangerate-api.com v6). Caches for 24h.
import dotenv from 'dotenv';
dotenv.config();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Market → currency metadata.
export const CURRENCY_MAP = {
  hollywood: { code: 'USD', symbol: '$',  country: 'United States' },
  bollywood: { code: 'INR', symbol: '₹',  country: 'India'         },
  korean:    { code: 'KRW', symbol: '₩',  country: 'South Korea'   },
  japanese:  { code: 'JPY', symbol: '¥',  country: 'Japan'         },
  european:  { code: 'EUR', symbol: '€',  country: 'Europe'        },
};

// In-memory cache.
let cachedRates = null;      // { USD:1, KRW:1350, INR:84, JPY:150, EUR:0.92, … }
let cacheTimestamp = 0;

function isCacheValid() {
  return cachedRates !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

// Fetch from exchangerate-api.com v6 (native fetch — Node 18+).
async function fetchFromApi() {
  const key = process.env.EXCHANGE_RATE_API_KEY;
  if (!key) {
    console.warn('[rates] EXCHANGE_RATE_API_KEY not set — using hardcoded fallback rates');
    return null;
  }
  const url = `https://v6.exchangerate-api.com/v6/${key}/latest/USD`;
  console.log('[rates] fetching live exchange rates from exchangerate-api.com...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`exchangerate-api returned ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(`exchangerate-api error: ${data['error-type']}`);
  return data.conversion_rates; // { USD:1, KRW:1350.5, INR:84.2, … }
}

// Conservative hardcoded fallback (updated June 2026).
const FALLBACK_RATES = {
  USD: 1,
  INR: 84.5,
  KRW: 1360,
  JPY: 157,
  EUR: 0.93,
};

// Init (called once on server startup). Safe to call multiple times.
export async function initRates() {
  if (isCacheValid()) return;
  try {
    const rates = await fetchFromApi();
    if (rates) {
      cachedRates = rates;
      cacheTimestamp = Date.now();
      console.log(`[rates] live rates cached (USD/KRW=${rates.KRW}, USD/INR=${rates.INR}, USD/JPY=${rates.JPY}, USD/EUR=${rates.EUR})`);
    } else {
      cachedRates = FALLBACK_RATES;
      cacheTimestamp = Date.now();
      console.log('[rates] using hardcoded fallback rates');
    }
  } catch (err) {
    console.error('[rates] fetch failed, falling back to hardcoded rates:', err.message);
    cachedRates = FALLBACK_RATES;
    cacheTimestamp = Date.now();
  }
}

// Background refresh so a stale cache never blocks a request.
export function refreshRatesIfStale() {
  if (!isCacheValid()) {
    initRates().catch((e) => console.error('[rates] background refresh failed:', e.message));
  }
}

// Convert USD amount (in dollars) → local currency amount.
// Returns number in local currency units.
export function convertFromUSD(amountUSD, currencyCode) {
  const rates = cachedRates || FALLBACK_RATES;
  const rate = rates[currencyCode] ?? 1;
  return amountUSD * rate;
}

// Get the exchange rate for a currency (how many local units per USD).
export function getRate(currencyCode) {
  const rates = cachedRates || FALLBACK_RATES;
  return rates[currencyCode] ?? 1;
}

// -------------------------------------------------------------------
// Formatting helpers
// -------------------------------------------------------------------

// Format a USD million amount as "$67.9M", "$1.23B", etc.
export function formatUSD(millions) {
  if (millions >= 1000) return `$${(millions / 1000).toFixed(2)}B`;
  return `$${millions.toFixed(1)}M`;
}

// Format a local-currency amount with appropriate scale.
export function formatLocal(amountLocal, currencyCode, symbol) {
  switch (currencyCode) {
    case 'USD': {
      const m = amountLocal / 1_000_000;
      return m >= 1000 ? `${symbol}${(m / 1000).toFixed(2)}B` : `${symbol}${m.toFixed(1)}M`;
    }
    case 'KRW': {
      // Express in billions (억 = 100M KRW; conventionally "B" for english)
      const b = amountLocal / 1_000_000_000;
      return `${symbol}${b.toFixed(1)}B`;
    }
    case 'JPY': {
      const b = amountLocal / 1_000_000_000;
      return `${symbol}${b.toFixed(1)}B`;
    }
    case 'INR': {
      // Express in Crore (1 Cr = 10M INR)
      const cr = amountLocal / 10_000_000;
      return `${symbol}${Math.round(cr)}Cr`;
    }
    case 'EUR': {
      const m = amountLocal / 1_000_000;
      return m >= 1000 ? `${symbol}${(m / 1000).toFixed(2)}B` : `${symbol}${m.toFixed(1)}M`;
    }
    default: {
      const m = amountLocal / 1_000_000;
      return `${symbol}${m.toFixed(1)}M`;
    }
  }
}

export async function testConnection() {
  try {
    if (!process.env.EXCHANGE_RATE_API_KEY) {
      return { ok: true, note: 'EXCHANGE_RATE_API_KEY not set — using fallback rates' };
    }
    await fetchFromApi();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
