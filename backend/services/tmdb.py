import os
from datetime import datetime, timedelta, timezone
import httpx
from dotenv import load_dotenv

load_dotenv()

BASE = 'https://api.themoviedb.org/3'

BOLLYWOOD_LANGS = {'hi', 'te', 'ta', 'ml', 'kn'}
EUROPEAN_COUNTRIES = {'GB', 'FR', 'ES', 'IT', 'DE', 'SE', 'DK', 'NO', 'NL'}

MARKET_COUNTRY = {
    'hollywood': 'US', 'bollywood': 'IN', 'korean': 'KR',
    'japanese': 'JP', 'european': 'GB',
}


def _build_request():
    bearer = os.getenv('TMDB_READ_ACCESS_TOKEN')
    api_key = os.getenv('TMDB_API_KEY')
    if bearer:
        return {'Authorization': f'Bearer {bearer}', 'Content-Type': 'application/json'}, {}
    if api_key:
        return {}, {'api_key': api_key}
    raise ValueError('No TMDB credentials: set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY in .env')


async def _tmdb_get(pathname, params=None):
    headers, extra = _build_request()
    merged = {**(extra), **(params or {})}
    merged = {k: v for k, v in merged.items() if v is not None and v != ''}
    url = f'{BASE}{pathname}'
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(url, headers=headers, params=merged)
        res.raise_for_status()
        return res.json()


def _today():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _date_offset(months=0, years=0):
    d = datetime.now(timezone.utc)
    m = d.month + months
    y = d.year + years + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    return d.replace(year=y, month=m).strftime('%Y-%m-%d')


def _detect_market(production_countries, original_language):
    countries = [c.get('iso_3166_1', '') for c in (production_countries or [])]
    lang = original_language or ''
    if 'US' in countries and lang == 'en':
        return 'hollywood'
    if 'IN' in countries and lang in BOLLYWOOD_LANGS:
        return 'bollywood'
    if 'KR' in countries:
        return 'korean'
    if 'JP' in countries:
        return 'japanese'
    if any(c in EUROPEAN_COUNTRIES for c in countries):
        return 'european'
    if 'US' in countries:
        if lang in BOLLYWOOD_LANGS:
            return 'bollywood'
        if lang == 'ko':
            return 'korean'
        if lang == 'ja':
            return 'japanese'
        if lang in ('fr', 'de', 'es', 'it'):
            return 'european'
    return 'hollywood'


def _map_status(tmdb_status):
    s = (tmdb_status or '').lower()
    if s == 'released':
        return 'released'
    if s in ('in production', 'post production'):
        return 'in_production'
    return 'upcoming'


def _extract_mpaa(release_dates):
    results = (release_dates or {}).get('results', [])
    us = next((r for r in results if r.get('iso_3166_1') == 'US'), None)
    if us:
        cert = next(
            (rd.get('certification') for rd in us.get('release_dates', [])
             if rd.get('type') in (2, 3) and rd.get('certification')),
            None
        )
        if cert:
            return cert
        cert = next(
            (rd.get('certification') for rd in us.get('release_dates', [])
             if rd.get('certification')),
            None
        )
        if cert:
            return cert
    for entry in results:
        cert = next(
            (rd.get('certification') for rd in entry.get('release_dates', [])
             if rd.get('certification')),
            None
        )
        if cert:
            return cert
    return None


def _extract_trailer(videos):
    results = (videos or {}).get('results', [])
    official = next(
        (v for v in results if v.get('type') == 'Trailer' and v.get('official') and v.get('site') == 'YouTube'),
        None
    )
    if official:
        return f"https://www.youtube.com/watch?v={official['key']}"
    any_yt = next(
        (v for v in results if v.get('type') == 'Trailer' and v.get('site') == 'YouTube'),
        None
    )
    if any_yt:
        return f"https://www.youtube.com/watch?v={any_yt['key']}"
    return None


def _market_discover_params(market):
    mapping = {
        'bollywood': {'with_original_language': 'hi|te|ta|ml|kn'},
        'korean':    {'with_original_language': 'ko'},
        'japanese':  {'with_original_language': 'ja'},
        'european':  {'with_original_language': 'fr|de|es|it'},
        'hollywood': {'with_original_language': 'en'},
    }
    return mapping.get(market, {'with_original_language': 'en'})


async def _fetch_discover_page(params, page):
    data = await _tmdb_get('/discover/movie', {**params, 'page': page})
    return data.get('results', [])


async def search_film(query):
    try:
        data = await _tmdb_get('/search/movie', {'query': query, 'include_adult': False})
        return [
            {'tmdb_id': r['id'], 'title': r['title'],
             'release_date': r.get('release_date'), 'poster_path': r.get('poster_path'),
             'overview': r.get('overview')}
            for r in (data.get('results') or [])[:5]
        ]
    except Exception as e:
        print(f'[TMDB ERROR] search_film: {e}')
        return None


async def get_film_details(tmdb_id):
    try:
        d = await _tmdb_get(f'/movie/{tmdb_id}',
                            {'append_to_response': 'credits,release_dates,videos'})
        credits = d.get('credits', {})
        release_dates = d.get('release_dates', {})
        videos = d.get('videos', {})

        director_raw = next((c for c in credits.get('crew', []) if c.get('job') == 'Director'), None)
        cast_top5 = [
            {'name': c['name'], 'tmdb_person_id': c['id'], 'order': c['order']}
            for c in credits.get('cast', [])[:5]
        ]
        prod_countries = d.get('production_countries', [])
        orig_lang = d.get('original_language')

        return {
            'tmdb_id':               d['id'],
            'title':                 d['title'],
            'overview':              d.get('overview'),
            'release_date':          d.get('release_date'),
            'budget':                d.get('budget') or 0,
            'revenue':               d.get('revenue') or 0,
            'runtime':               d.get('runtime'),
            'popularity':            d.get('popularity', 0),
            'vote_average':          d.get('vote_average', 0),
            'vote_count':            d.get('vote_count', 0),
            'poster_path':           d.get('poster_path'),
            'original_language':     orig_lang,
            'belongs_to_collection': d.get('belongs_to_collection'),
            'genres':                [g['name'] for g in d.get('genres', [])],
            'genre_ids':             [g['id']   for g in d.get('genres', [])],
            'production_companies':  [{'name': c['name'], 'id': c['id']}
                                      for c in d.get('production_companies', [])],
            'production_countries':  [{'iso_3166_1': c['iso_3166_1'], 'name': c['name']}
                                      for c in prod_countries],
            'director':              {'name': director_raw['name'],
                                      'tmdb_person_id': director_raw['id']} if director_raw else None,
            'cast_top5':             cast_top5,
            'mpaa_rating':           _extract_mpaa(release_dates),
            'trailer_url':           _extract_trailer(videos),
            'market':                _detect_market(prod_countries, orig_lang),
            'status':                _map_status(d.get('status')),
            'budget_inferred':       False,
            'budget_source':         'tmdb' if (d.get('budget') or 0) > 0 else None,
        }
    except Exception as e:
        print(f'[TMDB ERROR] get_film_details: {e}')
        return None


async def get_person_filmography(tmdb_person_id):
    try:
        data = await _tmdb_get(f'/person/{tmdb_person_id}/movie_credits')
        as_cast = [
            {'tmdb_id': c['id'], 'title': c['title'], 'release_date': c.get('release_date'),
             'revenue': c.get('revenue', 0), 'budget': c.get('budget', 0),
             'character': c.get('character'), 'order': c['order']}
            for c in data.get('cast', []) if c.get('order', 99) <= 2
        ]
        as_crew = [
            {'tmdb_id': c['id'], 'title': c['title'], 'release_date': c.get('release_date'),
             'revenue': c.get('revenue', 0), 'budget': c.get('budget', 0)}
            for c in data.get('crew', []) if c.get('job') == 'Director'
        ]
        return {'as_cast': as_cast, 'as_crew': as_crew}
    except Exception as e:
        print(f'[TMDB ERROR] get_person_filmography: {e}')
        return None


async def get_upcoming_films(market):
    try:
        base = {
            'primary_release_date.gte': _today(),
            'primary_release_date.lte': _date_offset(months=18),
            'sort_by': 'popularity.desc',
            'include_adult': False,
            'language': 'en-US',
            **_market_discover_params(market),
        }
        import asyncio
        if market == 'european':
            gb_params = {k: v for k, v in base.items() if k != 'with_original_language'}
            gb_params['with_origin_country'] = 'GB'
            p1, p2, gb = await asyncio.gather(
                _fetch_discover_page(base, 1),
                _fetch_discover_page(base, 2),
                _fetch_discover_page(gb_params, 1),
            )
            seen, results = set(), []
            for r in [*p1, *p2, *gb]:
                if r['id'] not in seen:
                    seen.add(r['id'])
                    results.append(r)
        else:
            p1, p2 = await asyncio.gather(
                _fetch_discover_page(base, 1),
                _fetch_discover_page(base, 2),
            )
            results = [*p1, *p2]

        return [
            {'tmdb_id': r['id'], 'title': r['title'], 'release_date': r.get('release_date'),
             'poster_path': r.get('poster_path'), 'popularity': r.get('popularity', 0),
             'overview': r.get('overview')}
            for r in results[:50]
        ]
    except Exception as e:
        print(f'[TMDB ERROR] get_upcoming_films: {e}')
        return None


async def get_released_films_for_comps(genre_ids, market, _budget=None):
    try:
        primary = genre_ids[0] if isinstance(genre_ids, list) else genre_ids
        params = {
            'with_genres': primary,
            'primary_release_date.lte': _today(),
            'primary_release_date.gte': _date_offset(years=-8),
            'sort_by': 'revenue.desc',
            'vote_count.gte': 100,
            'include_adult': False,
            'language': 'en-US',
            **_market_discover_params(market),
        }
        import asyncio
        p1, p2 = await asyncio.gather(
            _fetch_discover_page(params, 1),
            _fetch_discover_page(params, 2),
        )
        return [
            {'tmdb_id': r['id'], 'title': r['title'], 'release_date': r.get('release_date'),
             'revenue': r.get('revenue', 0), 'budget': r.get('budget', 0),
             'genre_ids': r.get('genre_ids', []), 'poster_path': r.get('poster_path')}
            for r in ([*p1, *p2])[:30]
        ]
    except Exception as e:
        print(f'[TMDB ERROR] get_released_films_for_comps: {e}')
        return None


async def get_watch_providers(tmdb_id, market='hollywood'):
    try:
        data = await _tmdb_get(f'/movie/{tmdb_id}/watch/providers')
        country = MARKET_COUNTRY.get(market, 'US')
        region = (data.get('results') or {}).get(country, {})

        def _map_providers(lst):
            return [
                {'provider_id': p['provider_id'], 'provider_name': p['provider_name'],
                 'logo_path': p.get('logo_path'),
                 'logo_url': f"https://image.tmdb.org/t/p/original{p['logo_path']}"
                             if p.get('logo_path') else None}
                for p in (lst or [])
            ]

        return {
            'country':  country,
            'flatrate': _map_providers(region.get('flatrate')),
            'rent':     _map_providers(region.get('rent')),
            'buy':      _map_providers(region.get('buy')),
            'link':     region.get('link'),
        }
    except Exception:
        return None


async def test_connection():
    try:
        await _tmdb_get('/configuration')
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
