from datetime import datetime, timezone
from ...db.database import db

SEASON_MAP = {
    1:  {'score': 0.40, 'label': 'dump_season'},
    2:  {'score': 0.40, 'label': 'dump_season'},
    3:  {'score': 0.70, 'label': 'spring'},
    4:  {'score': 0.70, 'label': 'spring'},
    5:  {'score': 0.90, 'label': 'summer'},
    6:  {'score': 0.90, 'label': 'summer'},
    7:  {'score': 0.90, 'label': 'summer'},
    8:  {'score': 0.60, 'label': 'shoulder'},
    9:  {'score': 0.60, 'label': 'shoulder'},
    10: {'score': 0.60, 'label': 'shoulder'},
    11: {'score': 0.85, 'label': 'holiday'},
    12: {'score': 0.85, 'label': 'holiday'},
}


def _score_season(release_date):
    if not release_date:
        return {'score': 0.50, 'label': 'unknown', 'release_month': None}
    try:
        month = int(release_date.split('-')[1])
        entry = SEASON_MAP.get(month, {'score': 0.50, 'label': 'unknown'})
        return {'score': entry['score'], 'label': entry['label'], 'release_month': month}
    except Exception:
        return {'score': 0.50, 'label': 'unknown', 'release_month': None}


def _competition_score(count):
    if count == 0: return {'score': 1.00, 'label': 'clear_run'}
    if count == 1: return {'score': 0.70, 'label': 'some_competition'}
    if count == 2: return {'score': 0.50, 'label': 'competitive_weekend'}
    return             {'score': 0.30, 'label': 'crowded_weekend'}


def _is_major_competitor(row):
    return (
        (row.get('budget') or 0) >= 80_000_000 or
        bool(row.get('budget_inferred')) or
        bool(row.get('belongs_to_collection'))
    )


def _score_competition(film):
    release_date = film.get('release_date')
    if not release_date:
        return {'score': 1.00, 'label': 'clear_run', 'major_competitor_count': 0, 'competitor_titles': []}

    candidates = db.execute(
        """SELECT tmdb_id, title, budget, budget_inferred, belongs_to_collection
           FROM films
           WHERE release_date BETWEEN date(?, '-7 days') AND date(?, '+7 days')
             AND tmdb_id != ?
             AND status IN ('upcoming','in_production','fresh_release')""",
        (release_date, release_date, film.get('tmdb_id') or 0)
    ).fetchall()

    major = [dict(r) for r in candidates if _is_major_competitor(dict(r))]
    result = _competition_score(len(major))
    return {
        **result,
        'major_competitor_count': len(major),
        'competitor_titles': [r['title'] for r in major],
    }


def _days_until(release_date):
    if not release_date:
        return None
    try:
        rd = datetime.fromisoformat(release_date).replace(tzinfo=timezone.utc)
        delta = (rd - datetime.now(timezone.utc)).total_seconds()
        return int(delta / 86400) + 1
    except Exception:
        return None


def compute_market_score(film):
    season      = _score_season(film.get('release_date'))
    competition = _score_competition(film)
    days        = _days_until(film.get('release_date'))

    score = round((season['score'] * 0.50 + competition['score'] * 0.50) * 10_000) / 10_000

    return {
        'score': score,
        'components': {
            'season': {
                'score':         season['score'],
                'label':         season['label'],
                'release_month': season['release_month'],
            },
            'competition': {
                'score':                  competition['score'],
                'label':                  competition['label'],
                'major_competitor_count': competition['major_competitor_count'],
                'competitor_titles':      competition['competitor_titles'],
            },
        },
        'days_until_release': days,
        'release_date':       film.get('release_date'),
    }
