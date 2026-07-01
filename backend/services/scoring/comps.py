import json
from datetime import datetime, timezone
from ...db.database import db, execute_write
from ..tmdb import get_film_details, get_released_films_for_comps

GENRE_ID_MAP = {
    'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
    'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
    'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
    'Mystery': 9648, 'Romance': 10749, 'Science Fiction': 878,
    'Thriller': 53, 'War': 10752, 'Western': 37,
}

MARKET_OW_SPLITS = {
    'hollywood': {'domestic_pct': 0.40, 'ow_rate': 0.18},
    'bollywood': {'domestic_pct': 0.65, 'ow_rate': 0.40},
    'korean':    {'domestic_pct': 0.40, 'ow_rate': 0.35},
    'japanese':  {'domestic_pct': 0.85, 'ow_rate': 0.45},
    'european':  {'domestic_pct': 0.30, 'ow_rate': 0.12},
}

GLOBAL_OW_RATE     = 0.31
COMP_SCORE_CEILING = 300
MAX_ENRICH         = 10
TOP_N              = 5
WEIGHT_COMPS       = 3


def _safe_parse(v, fallback):
    if v is None:
        return fallback
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return fallback


def _r2(n): return round(n * 100) / 100
def _r4(n): return round(n * 10_000) / 10_000


def _budget_tier(budget):
    if not budget or budget <= 0: return 'unknown'
    if budget >= 150_000_000:     return 'tentpole'
    if budget >= 80_000_000:      return 'major'
    if budget >= 25_000_000:      return 'mid'
    if budget >= 5_000_000:       return 'indie'
    return 'micro'


def _normalise_db_row(row):
    row = dict(row)
    genre_names = _safe_parse(row.get('genres'), [])
    collection  = _safe_parse(row.get('belongs_to_collection'), None)
    return {
        'db_id':                row['id'],
        'tmdb_id':              row['tmdb_id'],
        'title':                row['title'],
        'release_date':         row.get('release_date'),
        'revenue':              row.get('revenue') or 0,
        'budget':               row.get('budget') or 0,
        'budget_inferred':      bool(row.get('budget_inferred')),
        'genre_ids':            [GENRE_ID_MAP[g] for g in genre_names if g in GENRE_ID_MAP],
        'genre_names':          genre_names,
        'market':               row.get('market') or 'hollywood',
        'belongs_to_collection': collection,
        'mpaa_rating':          row.get('mpaa_rating'),
        'source':               'db',
    }


def _normalise_discover(result, market):
    return {
        'db_id':                None,
        'tmdb_id':              result['tmdb_id'],
        'title':                result['title'],
        'release_date':         result.get('release_date'),
        'revenue':              0,
        'budget':               0,
        'budget_inferred':      False,
        'genre_ids':            result.get('genre_ids') or [],
        'genre_names':          [],
        'market':               market,
        'belongs_to_collection': None,
        'mpaa_rating':          None,
        'source':               'discover',
    }


async def _enrich_candidate(candidate):
    if candidate['source'] == 'db' and candidate['revenue'] > 0:
        return candidate

    existing = db.execute('SELECT * FROM films WHERE tmdb_id=?', (candidate['tmdb_id'],)).fetchone()
    if existing and (dict(existing).get('revenue') or 0) > 0:
        return _normalise_db_row(existing)

    d = await get_film_details(candidate['tmdb_id'])
    if not d or not d.get('revenue'):
        return None

    genre_names = d.get('genres') or []
    collection  = d.get('belongs_to_collection')

    execute_write(
        '''INSERT INTO films (
              tmdb_id, title, overview, market, status, release_date,
              budget, revenue, runtime, genres, cast_top5, director,
              production_companies, production_countries, original_language,
              poster_path, trailer_url, belongs_to_collection, mpaa_rating,
              vote_average, vote_count, popularity, last_tmdb_sync
           ) VALUES (
              :tmdb_id, :title, :overview, :market, :status, :release_date,
              :budget, :revenue, :runtime, :genres, :cast_top5, :director,
              :production_companies, :production_countries, :original_language,
              :poster_path, :trailer_url, :belongs_to_collection, :mpaa_rating,
              :vote_average, :vote_count, :popularity, :last_tmdb_sync
           )
           ON CONFLICT(tmdb_id) DO UPDATE SET
              title=excluded.title, market=excluded.market, status=excluded.status,
              budget=excluded.budget, revenue=excluded.revenue, genres=excluded.genres,
              belongs_to_collection=excluded.belongs_to_collection,
              mpaa_rating=excluded.mpaa_rating, vote_average=excluded.vote_average,
              vote_count=excluded.vote_count, popularity=excluded.popularity,
              last_tmdb_sync=excluded.last_tmdb_sync''',
        {
            'tmdb_id':               d['tmdb_id'],
            'title':                 d['title'],
            'overview':              d.get('overview'),
            'market':                d.get('market') or candidate['market'],
            'status':                d.get('status') or 'released',
            'release_date':          d.get('release_date'),
            'budget':                d.get('budget') or 0,
            'revenue':               d.get('revenue') or 0,
            'runtime':               d.get('runtime'),
            'genres':                json.dumps(genre_names),
            'cast_top5':             json.dumps(d.get('cast_top5') or []),
            'director':              json.dumps(d.get('director')),
            'production_companies':  json.dumps(d.get('production_companies') or []),
            'production_countries':  json.dumps(d.get('production_countries') or []),
            'original_language':     d.get('original_language'),
            'poster_path':           d.get('poster_path'),
            'trailer_url':           d.get('trailer_url'),
            'belongs_to_collection': json.dumps(collection) if collection else None,
            'mpaa_rating':           d.get('mpaa_rating'),
            'vote_average':          d.get('vote_average') or 0,
            'vote_count':            d.get('vote_count') or 0,
            'popularity':            d.get('popularity') or 0,
            'last_tmdb_sync':        datetime.now(timezone.utc).isoformat(),
        }
    )
    row = db.execute('SELECT * FROM films WHERE tmdb_id=?', (d['tmdb_id'],)).fetchone()
    return _normalise_db_row(row) if row else None


def _prelim_score(film, candidate):
    film_genre_names = _safe_parse(film.get('genres'), [])
    film_primary_id  = next((GENRE_ID_MAP[g] for g in film_genre_names if g in GENRE_ID_MAP), None)
    pts = 0
    if film_primary_id and candidate['genre_ids'] and candidate['genre_ids'][0] == film_primary_id:
        pts += 3
    if (film.get('market') or 'hollywood') == candidate['market']:
        pts += 3
    yr = int(candidate['release_date'][:4]) if candidate.get('release_date') else None
    if yr:
        ago = datetime.now(timezone.utc).year - yr
        if ago <= 2:   pts += 2
        elif ago <= 5: pts += 1
    return pts


def _full_score(film, candidate):
    film_genre_names = _safe_parse(film.get('genres'), [])
    film_primary_id  = next((GENRE_ID_MAP[g] for g in film_genre_names if g in GENRE_ID_MAP), None)
    film_collection  = _safe_parse(film.get('belongs_to_collection'), None)
    film_has_coll    = bool(film_collection)
    film_budget      = 150_000_000 if film.get('budget_inferred') else (film.get('budget') or 0)
    film_tier        = _budget_tier(film_budget)
    film_mpaa        = film.get('mpaa_rating')

    cand_budget = 150_000_000 if candidate['budget_inferred'] else (candidate['budget'] or 0)
    cand_tier   = _budget_tier(cand_budget)
    cand_has_coll = bool(candidate['belongs_to_collection'])
    cand_mpaa     = candidate['mpaa_rating']
    cand_primary  = candidate['genre_ids'][0] if candidate['genre_ids'] else None

    pts, reasons = 0, []
    if film_primary_id and cand_primary and film_primary_id == cand_primary:
        pts += 3
        reasons.append(f'Same genre ({film_genre_names[0] if film_genre_names else "Action"})')
    if (film.get('market') or 'hollywood') == candidate['market']:
        pts += 3
        label = candidate['market'].capitalize()
        reasons.append(f'Same market ({label})')
    if film_tier == cand_tier:
        pts += 2
        reasons.append(f'Same budget tier ({film_tier})')
    if film_has_coll == cand_has_coll:
        pts += 2
        reasons.append('Same franchise structure')
    if film_mpaa and cand_mpaa and film_mpaa == cand_mpaa:
        pts += 1
        reasons.append(f'Same MPAA rating ({film_mpaa})')
    yr = int(candidate['release_date'][:4]) if candidate.get('release_date') else None
    if yr:
        ago = datetime.now(timezone.utc).year - yr
        if ago <= 2:
            pts += 2; reasons.append(f'Recent release ({yr})')
        elif ago <= 5:
            pts += 1; reasons.append(f'Recent release ({yr})')

    return {'similarity_score': _r4(pts / 13), 'match_reasons': reasons}


def _comp_ow(revenue, market):
    sp = MARKET_OW_SPLITS.get(market) or MARKET_OW_SPLITS['hollywood']
    return {
        'ow_origin': _r2(revenue * sp['domestic_pct'] * sp['ow_rate'] / 1_000_000),
        'ow_global': _r2(revenue * GLOBAL_OW_RATE / 1_000_000),
    }


def _calc_from_cached(rows):
    top3 = rows[:WEIGHT_COMPS]
    tw   = sum(r['similarity_score'] for r in top3)
    w_ori = sum(r['comp_actual_ow_origin'] * r['similarity_score'] for r in top3) / tw
    w_glo = sum(r['comp_actual_ow_global'] * r['similarity_score'] for r in top3) / tw
    return {
        'score':                  _r4(min(w_glo / COMP_SCORE_CEILING, 1.0)),
        'weighted_ow_origin_usd': _r2(w_ori),
        'weighted_ow_global_usd': _r2(w_glo),
        'comps_found':            len(rows),
        'comps_used':             [
            {'title': r['title'], 'release_date': r.get('release_date'),
             'similarity_score': r['similarity_score'],
             'match_reasons': _safe_parse(r.get('match_reasons'), []),
             'actual_ow_origin_usd': r['comp_actual_ow_origin'],
             'actual_ow_global_usd': r['comp_actual_ow_global']}
            for r in rows
        ],
        'data_available': True,
    }


async def compute_comp_score(film):
    film_db_id = film.get('id')

    if film_db_id:
        cached = db.execute(
            '''SELECT ca.*, f.title, f.revenue, f.release_date, f.market
               FROM comp_anchors ca JOIN films f ON ca.comp_film_id=f.id
               WHERE ca.upcoming_film_id=?
               ORDER BY ca.similarity_score DESC LIMIT ?''',
            (film_db_id, TOP_N)
        ).fetchall()
        cached = [dict(r) for r in cached]
        if len(cached) >= 3 and all(r['comp_actual_ow_global'] > 0 for r in cached):
            print(f'[COMPS] Using cached comps for "{film.get("title")}"')
            return _calc_from_cached(cached)

    film_genre_names = _safe_parse(film.get('genres'), [])
    primary_genre_name = film_genre_names[0] if film_genre_names else 'Action'
    primary_genre_id   = GENRE_ID_MAP.get(primary_genre_name, 28)
    film_market        = film.get('market') or 'hollywood'
    film_budget        = 150_000_000 if film.get('budget_inferred') else (film.get('budget') or 0)

    print(f'[COMPS] Finding comps for "{film.get("title")}" ({film_market}, genre={primary_genre_name})')

    discover_results = await get_released_films_for_comps(
        [primary_genre_id], film_market, film_budget or 150_000_000
    )

    db_rows = db.execute(
        'SELECT * FROM films WHERE status=? AND market=? AND revenue>0 AND tmdb_id!=?',
        ('released', film_market, film.get('tmdb_id') or 0)
    ).fetchall()

    seen, candidates = set(), []
    for row in db_rows:
        row = dict(row)
        seen.add(row['tmdb_id'])
        candidates.append(_normalise_db_row(row))
    for r in (discover_results or []):
        if r['tmdb_id'] not in seen:
            seen.add(r['tmdb_id'])
            existing = db.execute('SELECT * FROM films WHERE tmdb_id=?', (r['tmdb_id'],)).fetchone()
            candidates.append(_normalise_db_row(existing) if existing else _normalise_discover(r, film_market))

    print(f'[COMPS] {len(candidates)} candidates found')

    by_prelim = sorted(
        [{'candidate': c, 'prelim': _prelim_score(film, c)} for c in candidates],
        key=lambda x: x['prelim'], reverse=True
    )[:MAX_ENRICH]

    enriched = []
    for item in by_prelim:
        result = await _enrich_candidate(item['candidate'])
        if result and result['revenue'] > 0:
            enriched.append(result)

    print(f'[COMPS] {len(enriched)} candidates after revenue enrichment')

    if not enriched:
        return {
            'score': 0.30, 'weighted_ow_origin_usd': None, 'weighted_ow_global_usd': None,
            'comps_found': 0, 'comps_used': [], 'data_available': False,
            'reason': 'No comparable films found',
        }

    scored = []
    for c in enriched:
        sim = _full_score(film, c)
        ow  = _comp_ow(c['revenue'], c['market'])
        scored.append({**c, **sim, **ow})
    scored.sort(key=lambda x: x['similarity_score'], reverse=True)
    top5 = scored[:TOP_N]

    if film_db_id:
        execute_write('DELETE FROM comp_anchors WHERE upcoming_film_id=?', (film_db_id,))
        for c in top5:
            if c.get('db_id'):
                execute_write(
                    '''INSERT INTO comp_anchors
                       (upcoming_film_id, comp_film_id, similarity_score,
                        match_reasons, comp_actual_ow_origin, comp_actual_ow_global)
                       VALUES (?,?,?,?,?,?)''',
                    (film_db_id, c['db_id'], c['similarity_score'],
                     json.dumps(c['match_reasons']), c['ow_origin'], c['ow_global'])
                )

    top3 = top5[:WEIGHT_COMPS]
    tw   = sum(c['similarity_score'] for c in top3)
    w_ori = sum(c['ow_origin'] * c['similarity_score'] for c in top3) / tw
    w_glo = sum(c['ow_global'] * c['similarity_score'] for c in top3) / tw
    score = _r4(min(w_glo / COMP_SCORE_CEILING, 1.0))

    print(f'[COMPS] weighted OW global = ${_r2(w_glo)}M → comp_score = {score}')

    return {
        'score':                  score,
        'weighted_ow_origin_usd': _r2(w_ori),
        'weighted_ow_global_usd': _r2(w_glo),
        'comps_found':            len(top5),
        'comps_used': [
            {'title': c['title'], 'release_date': c.get('release_date'),
             'similarity_score': c['similarity_score'], 'match_reasons': c['match_reasons'],
             'actual_ow_origin_usd': c['ow_origin'], 'actual_ow_global_usd': c['ow_global']}
            for c in top5
        ],
        'data_available': True,
    }
