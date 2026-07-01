import json
from ...db.database import db

GENRE_SCORES = {
    'Action': 0.80, 'Adventure': 0.80, 'Animation': 0.75, 'Family': 0.75,
    'Science Fiction': 0.70, 'Fantasy': 0.70, 'Horror': 0.65, 'Comedy': 0.60,
    'Thriller': 0.55, 'Crime': 0.55, 'Mystery': 0.50, 'Music': 0.50,
    'Romance': 0.45, 'War': 0.45, 'Drama': 0.40, 'Biography': 0.40,
    'History': 0.35, 'Western': 0.35, 'Documentary': 0.20,
}

MPAA_SCORES = {'G': 0.70, 'PG': 0.75, 'PG-13': 0.85, 'R': 0.60, 'NC-17': 0.20, 'NR': 0.40}

MAJOR_STUDIO_SIGNALS = [
    'disney', 'marvel', 'warner', 'universal', 'paramount',
    'sony', 'lionsgate', 'netflix', 'apple', 'amazon', 'a24',
    'dreamworks', 'pixar', 'new line', 'columbia',
    '20th century', 'searchlight',
]


def _safe_parse(v, fallback):
    if v is None:
        return fallback
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return fallback


def _r4(n):
    return round(n * 10000) / 10000


def _score_budget(film):
    budget = int(film.get('budget') or 0)
    inferred = bool(film.get('budget_inferred'))
    if budget >= 150_000_000:
        return {'score': 1.00, 'tier': 'tentpole', 'value': budget}
    if budget >= 80_000_000:
        return {'score': 0.80, 'tier': 'major',    'value': budget}
    if budget >= 25_000_000:
        return {'score': 0.55, 'tier': 'mid',      'value': budget}
    if budget >= 5_000_000:
        return {'score': 0.30, 'tier': 'indie',    'value': budget}
    if budget > 0:
        return {'score': 0.15, 'tier': 'micro',    'value': budget}
    if budget == 0 and inferred:
        return {'score': 0.65, 'tier': 'unknown',  'value': budget}
    return {'score': 0.10, 'tier': 'unknown', 'value': budget}


def _score_franchise(film):
    collection = _safe_parse(film.get('belongs_to_collection'), None)
    if not collection or not collection.get('id'):
        return {'score': 0.30, 'label': 'original_ip'}

    try:
        row = db.execute(
            '''SELECT MAX(revenue) AS max_rev, COUNT(*) AS cnt
               FROM films
               WHERE json_extract(belongs_to_collection, '$.id') = ?
                 AND status = 'released' AND revenue > 0 AND tmdb_id != ?''',
            (collection['id'], film.get('tmdb_id') or 0)
        ).fetchone()
        max_rev = row['max_rev'] or 0 if row else 0
        cnt = row['cnt'] or 0 if row else 0
    except Exception:
        rows = db.execute(
            "SELECT revenue, belongs_to_collection FROM films WHERE status='released' AND revenue>0 AND tmdb_id!=?",
            (film.get('tmdb_id') or 0,)
        ).fetchall()
        max_rev, cnt = 0, 0
        for r in rows:
            col = _safe_parse(r['belongs_to_collection'], None)
            if col and col.get('id') == collection['id']:
                cnt += 1
                if (r['revenue'] or 0) > max_rev:
                    max_rev = r['revenue']

    if cnt == 0:
        return {'score': 0.65, 'label': 'franchise_unverified'}
    if max_rev >= 500_000_000:
        return {'score': 0.95, 'label': 'mega_franchise'}
    if max_rev >= 100_000_000:
        return {'score': 0.80, 'label': 'major_franchise'}
    return {'score': 0.65, 'label': 'franchise'}


def _score_genre(film):
    genres = _safe_parse(film.get('genres'), [])
    if not genres:
        return {'score': 0.45, 'primary_genre': 'unknown'}
    best_genre, best_score = genres[0], GENRE_SCORES.get(genres[0], 0.45)
    for g in genres:
        s = GENRE_SCORES.get(g, 0.45)
        if s > best_score:
            best_genre, best_score = g, s
    return {'score': best_score, 'primary_genre': best_genre}


def _score_talent(film):
    director = _safe_parse(film.get('director'), None)
    cast = _safe_parse(film.get('cast_top5'), [])
    DEFAULT = 0.35

    director_score, director_found = DEFAULT, False
    if director and director.get('tmdb_person_id'):
        row = db.execute(
            'SELECT avg_ow_when_leading FROM talent_scores WHERE tmdb_person_id=? AND role=?',
            (director['tmdb_person_id'], 'director')
        ).fetchone()
        if row:
            director_score = min(row['avg_ow_when_leading'] / 200_000_000, 1.0)
            director_found = True

    top2 = [c for c in cast[:2] if c.get('tmdb_person_id')]
    cast_score, cast_found = DEFAULT, 0
    if top2:
        ids = [c['tmdb_person_id'] for c in top2]
        placeholders = ','.join('?' * len(ids))
        rows = db.execute(
            f"SELECT avg_ow_when_leading FROM talent_scores WHERE tmdb_person_id IN ({placeholders}) AND role='actor'",
            ids
        ).fetchall()
        cast_found = len(rows)
        if rows:
            avg = sum(r['avg_ow_when_leading'] for r in rows) / len(rows)
            cast_score = min(avg / 150_000_000, 1.0)

    score = _r4(director_score * 0.40 + cast_score * 0.60)
    return {'score': score, 'director_score': _r4(director_score),
            'cast_score': _r4(cast_score), 'director_found': director_found, 'cast_found': cast_found}


def _score_mpaa(film):
    rating = film.get('mpaa_rating')
    return {'score': MPAA_SCORES.get(rating, 0.50), 'rating': rating or 'unknown'}


def _check_major_studio(film):
    companies = _safe_parse(film.get('production_companies'), [])
    return any(
        sig in (c.get('name') or '').lower()
        for c in companies for sig in MAJOR_STUDIO_SIGNALS
    )


def compute_structural_score(film):
    budget    = _score_budget(film)
    franchise = _score_franchise(film)
    genre     = _score_genre(film)
    talent    = _score_talent(film)
    mpaa      = _score_mpaa(film)
    major_studio = _check_major_studio(film)

    if (int(film.get('budget') or 0) == 0) and major_studio:
        budget['score'] = max(budget['score'], 0.65)

    score = _r4(
        budget['score']    * 0.30 +
        franchise['score'] * 0.25 +
        genre['score']     * 0.20 +
        talent['score']    * 0.15 +
        mpaa['score']      * 0.10
    )

    return {
        'score': score,
        'components': {
            'budget':    {'score': budget['score'],    'tier': budget['tier'],    'value': budget['value']},
            'franchise': {'score': franchise['score'], 'label': franchise['label']},
            'genre':     {'score': genre['score'],     'primary_genre': genre['primary_genre']},
            'talent':    {'score': talent['score'],    'director_score': talent['director_score'],
                          'cast_score': talent['cast_score'], 'director_found': talent['director_found'],
                          'cast_found': talent['cast_found']},
            'mpaa':      {'score': mpaa['score'],      'rating': mpaa['rating']},
        },
        'major_studio': major_studio,
    }
