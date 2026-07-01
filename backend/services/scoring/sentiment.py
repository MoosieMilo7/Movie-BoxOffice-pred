from ...db.database import db

NO_DATA_RESULT = {
    'score': 0.35,
    'raw_score': None,
    'label': 'no_data',
    'one_line': 'No social data scraped yet',
    'data_available': False,
    'scraped_at': None,
}


def compute_sentiment_score(film_id):
    row = db.execute(
        'SELECT * FROM sentiment_snapshots WHERE film_id=? ORDER BY scraped_at DESC LIMIT 1',
        (film_id,)
    ).fetchone()

    if not row:
        return NO_DATA_RESULT

    raw = row['sentiment_score'] or 0
    return {
        'score':              raw / 5,
        'raw_score':          raw,
        'label':              row['sentiment_label'],
        'one_line':           row['sentiment_one_line'],
        'data_available':     True,
        'trailer_view_count': row['trailer_view_count'] or 0,
        'raw_mention_count':  row['raw_mention_count'] or 0,
        'scraped_at':         row['scraped_at'],
    }
