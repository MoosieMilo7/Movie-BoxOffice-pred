/**
 * tmdb.js — TMDB API client (v3 endpoints, Bearer token auth)
 *
 * Auth priority:
 *   1. TMDB_READ_ACCESS_TOKEN (Bearer JWT — preferred)
 *   2. TMDB_API_KEY            (legacy api_key query param — fallback)
 */
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://api.themoviedb.org/3';

/* ------------------------------------------------------------------ */
/* Auth + fetch wrapper                                               */
/* ------------------------------------------------------------------ */

function buildRequest() {
  const bearer = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey  = process.env.TMDB_API_KEY;

  if (bearer) {
    return {
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      extraParams: {},
    };
  }
  if (apiKey) {
    return { headers: {}, extraParams: { api_key: apiKey } };
  }
  throw new Error('No TMDB credentials: set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY in .env');
}

async function tmdbGet(pathname, queryParams = {}) {
  const { headers, extraParams } = buildRequest();
  const url = new URL(`${BASE}${pathname}`);
  for (const [k, v] of Object.entries({ ...extraParams, ...queryParams })) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 120)}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

const BOLLYWOOD_LANGS   = new Set(['hi', 'te', 'ta', 'ml', 'kn']);
const EUROPEAN_COUNTRIES = new Set(['GB','FR','ES','IT','DE','SE','DK','NO','NL']);

function detectMarket(productionCountries = [], originalLanguage = '') {
  const countries = productionCountries.map((c) => c.iso_3166_1);
  const lang = originalLanguage || '';

  if (countries.includes('US') && lang === 'en') return 'hollywood';
  if (countries.includes('IN') && BOLLYWOOD_LANGS.has(lang)) return 'bollywood';
  if (countries.includes('KR')) return 'korean';
  if (countries.includes('JP')) return 'japanese';
  if (countries.some((c) => EUROPEAN_COUNTRIES.has(c))) return 'european';
  // US film with non-English language — route by language
  if (countries.includes('US')) {
    if (BOLLYWOOD_LANGS.has(lang)) return 'bollywood';
    if (lang === 'ko') return 'korean';
    if (lang === 'ja') return 'japanese';
    if (['fr','de','es','it'].includes(lang)) return 'european';
  }
  return 'hollywood';
}

function mapStatus(tmdbStatus = '') {
  switch (tmdbStatus.toLowerCase()) {
    case 'released':        return 'released';
    case 'in production':
    case 'post production': return 'in_production';
    case 'planned':
    case 'announced':       return 'upcoming';
    default:                return 'upcoming';
  }
}

function extractMpaaRating(releaseDates) {
  const results = releaseDates?.results ?? [];
  // US theatrical certification first
  const usEntry = results.find((r) => r.iso_3166_1 === 'US');
  if (usEntry) {
    const cert = (usEntry.release_dates ?? [])
      .filter((r) => r.type === 3 || r.type === 2)
      .find((r) => r.certification)?.certification;
    if (cert) return cert;
    // Any US cert as fallback
    const anyCert = (usEntry.release_dates ?? []).find((r) => r.certification)?.certification;
    if (anyCert) return anyCert;
  }
  // Any other country
  for (const entry of results) {
    const cert = (entry.release_dates ?? []).find((r) => r.certification)?.certification;
    if (cert) return cert;
  }
  return null;
}

function extractTrailerUrl(videos) {
  const results = videos?.results ?? [];
  const official = results.find(
    (v) => v.type === 'Trailer' && v.official === true && v.site === 'YouTube'
  );
  if (official) return `https://www.youtube.com/watch?v=${official.key}`;
  const anyYT = results.find((v) => v.type === 'Trailer' && v.site === 'YouTube');
  if (anyYT) return `https://www.youtube.com/watch?v=${anyYT.key}`;
  return null;
}

function today() {
  return new Date().toISOString().split('T')[0];
}
function dateOffset(months = 0, years = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split('T')[0];
}

// Language + country params per market (for discover endpoints).
function marketDiscoverParams(market) {
  switch (market) {
    case 'bollywood': return { with_original_language: 'hi|te|ta|ml|kn' };
    case 'korean':    return { with_original_language: 'ko' };
    case 'japanese':  return { with_original_language: 'ja' };
    case 'european':  return { with_original_language: 'fr|de|es|it' };
    case 'hollywood':
    default:          return { with_original_language: 'en' };
  }
}

/* ------------------------------------------------------------------ */
/* 1. searchFilm(query)                                               */
/* ------------------------------------------------------------------ */

export async function searchFilm(query) {
  try {
    const data = await tmdbGet('/search/movie', {
      query,
      include_adult: false,
    });
    return (data.results ?? []).slice(0, 5).map((r) => ({
      tmdb_id:      r.id,
      title:        r.title,
      release_date: r.release_date ?? null,
      poster_path:  r.poster_path ?? null,
      overview:     r.overview ?? null,
    }));
  } catch (err) {
    console.error('[TMDB ERROR] searchFilm:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. getFilmDetails(tmdb_id)                                         */
/* ------------------------------------------------------------------ */

export async function getFilmDetails(tmdbId) {
  try {
    const d = await tmdbGet(`/movie/${tmdbId}`, {
      append_to_response: 'credits,release_dates,videos',
    });

    const credits      = d.credits ?? {};
    const releaseDates = d.release_dates ?? {};
    const videos       = d.videos ?? {};

    const director = (credits.crew ?? []).find((c) => c.job === 'Director') ?? null;
    const cast_top5 = (credits.cast ?? []).slice(0, 5).map((c) => ({
      name:           c.name,
      tmdb_person_id: c.id,
      order:          c.order,
    }));

    const budget  = d.budget  || 0;
    const revenue = d.revenue || 0;

    return {
      tmdb_id:               d.id,
      title:                 d.title,
      overview:              d.overview ?? null,
      release_date:          d.release_date ?? null,
      budget,
      revenue,
      runtime:               d.runtime ?? null,
      popularity:            d.popularity ?? 0,
      vote_average:          d.vote_average ?? 0,
      vote_count:            d.vote_count ?? 0,
      poster_path:           d.poster_path ?? null,
      original_language:     d.original_language ?? null,
      belongs_to_collection: d.belongs_to_collection ?? null,

      genres:     (d.genres ?? []).map((g) => g.name),
      genre_ids:  (d.genres ?? []).map((g) => g.id),

      production_companies: (d.production_companies ?? []).map((c) => ({
        name: c.name,
        id:   c.id,
      })),
      production_countries: (d.production_countries ?? []).map((c) => ({
        iso_3166_1: c.iso_3166_1,
        name:       c.name,
      })),

      director: director
        ? { name: director.name, tmdb_person_id: director.id }
        : null,
      cast_top5,

      mpaa_rating:  extractMpaaRating(releaseDates),
      trailer_url:  extractTrailerUrl(videos),

      market:        detectMarket(d.production_countries, d.original_language),
      status:        mapStatus(d.status),
      budget_inferred: false,
      budget_source:   budget > 0 ? 'tmdb' : null,
    };
  } catch (err) {
    console.error('[TMDB ERROR] getFilmDetails:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 3. getPersonFilmography(tmdb_person_id)                            */
/* ------------------------------------------------------------------ */

export async function getPersonFilmography(tmdbPersonId) {
  try {
    const data = await tmdbGet(`/person/${tmdbPersonId}/movie_credits`);

    const as_cast = (data.cast ?? [])
      .filter((c) => c.order <= 2)
      .map((c) => ({
        tmdb_id:      c.id,
        title:        c.title,
        release_date: c.release_date ?? null,
        revenue:      c.revenue ?? 0,
        budget:       c.budget ?? 0,
        character:    c.character ?? null,
        order:        c.order,
      }));

    const as_crew = (data.crew ?? [])
      .filter((c) => c.job === 'Director')
      .map((c) => ({
        tmdb_id:      c.id,
        title:        c.title,
        release_date: c.release_date ?? null,
        revenue:      c.revenue ?? 0,
        budget:       c.budget ?? 0,
      }));

    return { as_cast, as_crew };
  } catch (err) {
    console.error('[TMDB ERROR] getPersonFilmography:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 4. getUpcomingFilms(market)                                        */
/* ------------------------------------------------------------------ */

async function fetchDiscoverPage(params, page) {
  const data = await tmdbGet('/discover/movie', { ...params, page });
  return data.results ?? [];
}

export async function getUpcomingFilms(market) {
  try {
    const baseParams = {
      'primary_release_date.gte': today(),
      'primary_release_date.lte': dateOffset(18),
      sort_by:                    'popularity.desc',
      include_adult:              false,
      language:                   'en-US',
      ...marketDiscoverParams(market),
    };

    let results;
    if (market === 'european') {
      // European: fetch non-English European language films + UK English separately.
      const [p1, p2, gbP1] = await Promise.all([
        fetchDiscoverPage(baseParams, 1),
        fetchDiscoverPage(baseParams, 2),
        fetchDiscoverPage(
          { ...baseParams, with_original_language: undefined, with_origin_country: 'GB' },
          1
        ),
      ]);
      const seen = new Set();
      results = [];
      for (const r of [...p1, ...p2, ...gbP1]) {
        if (!seen.has(r.id)) { seen.add(r.id); results.push(r); }
      }
    } else {
      const [p1, p2] = await Promise.all([
        fetchDiscoverPage(baseParams, 1),
        fetchDiscoverPage(baseParams, 2),
      ]);
      results = [...p1, ...p2];
    }

    return results.slice(0, 50).map((r) => ({
      tmdb_id:      r.id,
      title:        r.title,
      release_date: r.release_date ?? null,
      poster_path:  r.poster_path ?? null,
      popularity:   r.popularity ?? 0,
      overview:     r.overview ?? null,
    }));
  } catch (err) {
    console.error('[TMDB ERROR] getUpcomingFilms:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 5. getReleasedFilmsForComps(genre_ids, market, budget)             */
/* ------------------------------------------------------------------ */

// budget is accepted for future budget-proximity filtering but not yet used in the TMDB query.
export async function getReleasedFilmsForComps(genre_ids, market, _budget) {
  try {
    const primaryGenre = Array.isArray(genre_ids) ? genre_ids[0] : genre_ids;
    const params = {
      with_genres:                primaryGenre,
      'primary_release_date.lte': today(),
      'primary_release_date.gte': dateOffset(0, -8),
      sort_by:                    'revenue.desc',
      'vote_count.gte':           100,
      include_adult:              false,
      language:                   'en-US',
      ...marketDiscoverParams(market),
    };

    const [p1, p2] = await Promise.all([
      fetchDiscoverPage(params, 1),
      fetchDiscoverPage(params, 2),
    ]);

    return [...p1, ...p2].slice(0, 30).map((r) => ({
      tmdb_id:      r.id,
      title:        r.title,
      release_date: r.release_date ?? null,
      revenue:      r.revenue ?? 0,
      budget:       r.budget ?? 0,
      genre_ids:    r.genre_ids ?? [],
      poster_path:  r.poster_path ?? null,
    }));
  } catch (err) {
    console.error('[TMDB ERROR] getReleasedFilmsForComps:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Health check                                                       */
/* ------------------------------------------------------------------ */

// Country code per market for watch-provider lookups
const MARKET_COUNTRY = {
  hollywood: 'US', bollywood: 'IN', korean: 'KR', japanese: 'JP', european: 'GB',
};

/**
 * Fetch streaming / rental / purchase availability from TMDB.
 * Returns { flatrate, rent, buy, link, country } or null on failure.
 */
export async function getWatchProviders(tmdbId, market = 'hollywood') {
  try {
    const data    = await tmdbGet(`/movie/${tmdbId}/watch/providers`);
    const country = MARKET_COUNTRY[market] || 'US';
    const region  = (data.results || {})[country] || {};
    return {
      country,
      flatrate: (region.flatrate || []).map(p => ({
        provider_id:   p.provider_id,
        provider_name: p.provider_name,
        logo_path:     p.logo_path,
        logo_url:      p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null,
      })),
      rent: (region.rent || []).map(p => ({
        provider_id:   p.provider_id,
        provider_name: p.provider_name,
        logo_path:     p.logo_path,
        logo_url:      p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null,
      })),
      buy: (region.buy || []).map(p => ({
        provider_id:   p.provider_id,
        provider_name: p.provider_name,
        logo_path:     p.logo_path,
        logo_url:      p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null,
      })),
      link: region.link || null,
    };
  } catch {
    return null;
  }
}

export async function testConnection() {
  try {
    await tmdbGet('/configuration');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
