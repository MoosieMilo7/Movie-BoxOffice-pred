from ...db.database import db

NO_DATA_RESULT = {
    'score': 0.30,
    'mention_velocity': None,
    'trailer_velocity': None,
    'volume_score': 0,
    'data_available': False,
    'reason': 'No social data yet',
    'components': {
        'mention_velocity': {'score': 0.40, 'velocity_pct': None, 'label': 'no_data'},
        'trailer_velocity': {'score': 0.40, 'velocity_pct': None, 'current_views': 0, 'previous_views': None},
        'volume':           {'score': 0, 'raw_count': 0, 'ceiling': 500_000},
    },
}

VOLUME_CEILING = 500_000


def _velocity_score(pct):
    if pct is None:  return 0.40
    if pct >= 100:   return 1.00
    if pct >= 50:    return 0.85
    if pct >= 20:    return 0.70
    if pct >= 5:     return 0.55
    if pct >= 0:     return 0.40
    if pct >= -20:   return 0.25
    return 0.10


def _velocity_label(pct):
    if pct is None:  return 'no_data'
    if pct >= 100:   return 'doubling'
    if pct >= 50:    return 'strong'
    if pct >= 20:    return 'healthy'
    if pct >= 5:     return 'mild'
    if pct >= 0:     return 'flat'
    if pct >= -20:   return 'declining'
    return 'falling'


def _r4(n):
    return round(n * 10_000) / 10_000


def compute_momentum_score(film_id):
    snapshots = db.execute(
        'SELECT * FROM sentiment_snapshots WHERE film_id=? ORDER BY scraped_at DESC LIMIT 2',
        (film_id,)
    ).fetchall()

    if not snapshots:
        return NO_DATA_RESULT

    latest   = dict(snapshots[0])
    previous = dict(snapshots[1]) if len(snapshots) > 1 else None

    mention_vel_pct = None if (previous is None or latest.get('mention_velocity') is None) \
                      else latest['mention_velocity']
    mention_vel_score = _velocity_score(mention_vel_pct)

    trailer_vel_pct = None
    if previous and (latest.get('trailer_view_count') or 0) > 0 and (previous.get('trailer_view_count') or 0) > 0:
        trailer_vel_pct = _r4(
            ((latest['trailer_view_count'] - previous['trailer_view_count']) /
             previous['trailer_view_count']) * 100
        )
    trailer_vel_score = _velocity_score(trailer_vel_pct)

    raw_count   = latest.get('raw_mention_count') or 0
    volume_score = _r4(min(raw_count / VOLUME_CEILING, 1.0))

    score = _r4(mention_vel_score * 0.40 + trailer_vel_score * 0.35 + volume_score * 0.25)

    return {
        'score': score,
        'components': {
            'mention_velocity': {
                'score':        mention_vel_score,
                'velocity_pct': mention_vel_pct,
                'label':        _velocity_label(mention_vel_pct),
            },
            'trailer_velocity': {
                'score':          trailer_vel_score,
                'velocity_pct':   trailer_vel_pct,
                'current_views':  latest.get('trailer_view_count') or 0,
                'previous_views': previous.get('trailer_view_count') if previous else None,
            },
            'volume': {
                'score':     volume_score,
                'raw_count': raw_count,
                'ceiling':   VOLUME_CEILING,
            },
        },
        'data_available': True,
    }
