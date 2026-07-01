from datetime import datetime, timezone


def determine_film_mode(film_data):
    today = datetime.now(timezone.utc)
    release_str = film_data.get('release_date')
    release_date = None
    if release_str:
        try:
            release_date = datetime.fromisoformat(release_str).replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    days_until = None
    days_since = None
    if release_date:
        delta = (release_date - today).total_seconds() / 86400
        if delta >= 0:
            days_until = int(delta) + 1
        else:
            days_since = int(-delta)

    has_revenue = (film_data.get('revenue') or 0) > 0

    if has_revenue:
        return {'mode': 'released', 'predict': False, 'reason': 'Revenue data confirmed'}
    if days_until is not None and days_until > 0:
        return {'mode': 'upcoming', 'predict': True, 'days_until_release': days_until,
                'reason': 'Release date is in the future'}
    if days_since is not None and days_since <= 30:
        return {'mode': 'fresh_release', 'predict': True, 'days_since_release': days_since,
                'reason': 'Recently opened, awaiting revenue data'}
    if days_since is not None and days_since > 30:
        return {'mode': 'released', 'predict': False,
                'reason': 'Released over 30 days ago, no revenue data available'}
    return {'mode': 'upcoming', 'predict': True, 'days_until_release': None,
            'reason': 'No release date confirmed yet'}
