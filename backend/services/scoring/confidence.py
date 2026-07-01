from datetime import datetime, timezone

TIERS  = ['low', 'medium', 'high', 'very_high']
RANGES = {'very_high': 0.15, 'high': 0.25, 'medium': 0.40, 'low': 0.60}


def _days_until(release_date):
    if not release_date:
        return None
    try:
        rd = datetime.fromisoformat(release_date).replace(tzinfo=timezone.utc)
        return int((rd - datetime.now(timezone.utc)).total_seconds() / 86400) + 1
    except Exception:
        return None


def _base_from_days(days):
    if days is None or days > 180: return 'low'
    if days > 90:  return 'low'
    if days > 30:  return 'medium'
    if days > 7:   return 'high'
    return 'very_high'


def _time_reason(days):
    if days is None:   return 'release date unknown'
    if days > 180:     return 'release is over 6 months away'
    if days > 90:      return 'release is 3-6 months away'
    if days > 30:      return 'release is 1-3 months away'
    if days > 7:       return 'release is within a month'
    return 'release is imminent'


def compute_confidence(film, sentiment_result, comp_result):
    days = _days_until(film.get('release_date'))
    base = _base_from_days(days)

    tier = TIERS.index(base)
    upgrade_count = 0
    upgrades, downgrades = [], []
    floor_applied = ceiling_applied = False

    has_budget = (film.get('budget') or 0) > 0 or bool(film.get('budget_inferred'))
    if has_budget and upgrade_count < 2:
        upgrades.append('budget known' if (film.get('budget') or 0) > 0 else 'budget inferred from franchise')
        tier += 1
        upgrade_count += 1

    if sentiment_result.get('data_available') and upgrade_count < 2:
        upgrades.append('social data available')
        tier += 1
        upgrade_count += 1

    comps_found = comp_result.get('comps_found', 0)
    if comps_found >= 3 and upgrade_count < 2:
        upgrades.append(f'strong comp anchor ({comps_found} films)')
        tier += 1
        upgrade_count += 1

    tier = min(tier, 3)

    no_budget = not ((film.get('budget') or 0) > 0) and not film.get('budget_inferred')
    if no_budget:
        downgrades.append('budget unknown')
        if tier > 0: tier -= 1
        else:        floor_applied = True

    if not sentiment_result.get('data_available') and days is not None and days < 30:
        downgrades.append('releasing soon without social data')
        if tier > 0: tier -= 1
        else:        floor_applied = True

    max_tier = 3
    if days is not None and days > 90:   max_tier = 1
    elif days is not None and days > 30: max_tier = 2
    if tier > max_tier:
        tier = max_tier
        ceiling_applied = True

    if tier < 0:
        tier = 0
        floor_applied = True

    level = TIERS[tier]

    parts = [_time_reason(days)]
    if (film.get('budget') or 0) > 0:  parts.append('budget confirmed')
    elif film.get('budget_inferred'):   parts.append('budget estimated from franchise')
    else:                               parts.append('budget unknown')

    if sentiment_result.get('data_available'): parts.append('social data available')
    else:                                       parts.append('awaiting social data')

    n = comps_found
    if n >= 3:    parts.append(f'strong comp anchor ({n} films)')
    elif n >= 1:  parts.append(f'weak comp anchor ({n} film{"s" if n > 1 else ""})')
    else:         parts.append('no comp anchor')

    return {
        'level':             level,
        'range_multiplier':  RANGES[level],
        'days_until_release': days,
        'reason':            ', '.join(parts),
        'adjustments': {
            'base':            base,
            'upgrades':        upgrades,
            'downgrades':      downgrades,
            'ceiling_applied': ceiling_applied,
            'floor_applied':   floor_applied,
        },
    }
