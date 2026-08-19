import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone

import anthropic
from dotenv import load_dotenv

from ..db.database import execute_write, fetchone, fetchall
from .apify_client import get_youtube_video_stats

load_dotenv()

CLAUDE_MODEL = 'claude-sonnet-4-6'
PREDICTABLE_STATUSES = ('upcoming', 'in_production', 'fresh_release')
REFRESH_INTERVAL_HOURS = 6
MAX_CONCURRENCY = 4

_anthropic_client = None


def _get_anthropic():
    global _anthropic_client
    if not os.getenv('ANTHROPIC_API_KEY'):
        raise ValueError('ANTHROPIC_API_KEY not set')
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
    return _anthropic_client


def _fallback_score(view_count):
    if view_count >= 20_000_000: return 3, 'hot',  f'{view_count/1_000_000:.1f}M trailer views — strong pre-release buzz'
    if view_count >= 3_000_000:  return 2, 'warm', f'{view_count/1_000_000:.1f}M trailer views — healthy interest'
    if view_count > 0:           return 1, 'cool', f'{view_count/1_000_000:.1f}M trailer views — modest interest so far'
    return 0, 'dead', 'No trailer engagement data yet'


async def _score_with_claude(film, stats, previous):
    try:
        client = _get_anthropic()
        budget = film.get('budget') or 0
        budget_ctx = f'${round(budget / 1_000_000)}M budget' if budget > 0 else 'unknown budget'
        prev_ctx = (
            f"Previous comment count ({previous['scraped_at']}): {previous['raw_mention_count']:,}"
            if previous else 'No prior snapshot for this film'
        )

        user_msg = f"""Film: {film.get('title')} ({film.get('market') or 'hollywood'}, {budget_ctx})
Days until release: {film.get('days_until_release', 'unknown')}

Trailer: "{stats['title']}"
Views: {stats['view_count']:,}
Likes: {stats['like_count']:,}
Comments: {stats['comment_count']:,}
{prev_ctx}"""

        resp = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=150,
            temperature=0,
            system=(
                'You are a social-buzz analyst scoring pre-release film sentiment from YouTube trailer engagement.\n'
                'Respond with EXACTLY one JSON object and nothing else — no markdown fences, no prose, '
                'no self-correction, no second attempt. Your entire reply must be parseable as JSON on its own:\n'
                '{"score": <int 0-5>, "label": "<dead|cool|warm|hot|viral>", "one_line": "<short observation, max 12 words>"}\n'
                'Guidance: 0=dead (no engagement), 1=cool, 2=warm (healthy interest), 3=hot (strong buzz), '
                '4=very hot, 5=viral (exceptional, tentpole-level).\n'
                'Judge views/likes/comments relative to what is typical for the budget tier given: '
                'a few hundred thousand views is strong for a small indie but weak for a $150M+ tentpole.'
            ),
            messages=[{'role': 'user', 'content': user_msg}],
        )
        text = ''.join(b.text for b in resp.content if b.type == 'text').strip()
        candidates = re.findall(r'\{[^{}]*\}', text, re.DOTALL)
        for candidate in reversed(candidates):
            try:
                data = json.loads(candidate)
                score = max(0, min(5, int(data['score'])))
                return score, data['label'], data['one_line']
            except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                continue
        raise ValueError(f'no parseable JSON object in response: {text!r}')
    except Exception as e:
        print(f'[SENTIMENT] Claude scoring failed, using fallback: {e}')
        return _fallback_score(stats['view_count'])


async def refresh_film_sentiment(film):
    trailer_url = film.get('trailer_url')
    if not trailer_url:
        print(f'[SENTIMENT] "{film["title"]}" has no trailer_url yet — skipping')
        return None

    scraped_at = datetime.now(timezone.utc).isoformat()

    try:
        stats = await get_youtube_video_stats(trailer_url)
    except Exception as e:
        print(f'[SENTIMENT] Apify scrape failed for "{film["title"]}": {e}')
        return None

    if not stats:
        print(f'[SENTIMENT] Apify returned no data for "{film["title"]}"')
        return None

    previous = fetchone(
        'SELECT * FROM sentiment_snapshots WHERE film_id=? ORDER BY scraped_at DESC LIMIT 1',
        (film['id'],)
    )

    score, label, one_line = await _score_with_claude(film, stats, previous)

    prev_comments = previous['raw_mention_count'] if previous else None
    mention_velocity = None
    if prev_comments:
        mention_velocity = round(((stats['comment_count'] - prev_comments) / prev_comments) * 100, 4)

    execute_write(
        '''INSERT INTO sentiment_snapshots (
              film_id, scraped_at, sentiment_score, sentiment_label, sentiment_one_line,
              trailer_view_count, raw_mention_count, previous_mention_count, mention_velocity, snapshot_data
           ) VALUES (
              :film_id, :scraped_at, :sentiment_score, :sentiment_label, :sentiment_one_line,
              :trailer_view_count, :raw_mention_count, :previous_mention_count, :mention_velocity, :snapshot_data
           )''',
        {
            'film_id':                film['id'],
            'scraped_at':             scraped_at,
            'sentiment_score':        score,
            'sentiment_label':        label,
            'sentiment_one_line':     one_line,
            'trailer_view_count':     stats['view_count'],
            'raw_mention_count':      stats['comment_count'],
            'previous_mention_count': prev_comments or 0,
            'mention_velocity':       mention_velocity,
            'snapshot_data':          json.dumps(stats),
        }
    )
    execute_write('UPDATE films SET last_apify_sync=? WHERE id=?', (scraped_at, film['id']))

    print(f'[SENTIMENT] "{film["title"]}": score={score} label={label} views={stats["view_count"]:,} comments={stats["comment_count"]:,}')
    return {'score': score, 'label': label, 'one_line': one_line}


def _films_due_for_refresh():
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=REFRESH_INTERVAL_HOURS)).isoformat()
    placeholders = ','.join('?' * len(PREDICTABLE_STATUSES))
    return fetchall(
        f'''SELECT * FROM films
            WHERE status IN ({placeholders})
              AND trailer_url IS NOT NULL AND trailer_url != ''
              AND (last_apify_sync IS NULL OR last_apify_sync < ?)
            ORDER BY popularity DESC''',
        [*PREDICTABLE_STATUSES, cutoff]
    )


async def refresh_due_sentiment():
    films = _films_due_for_refresh()
    if not films:
        print('[SENTIMENT] no films due for refresh')
        return {'checked': 0, 'updated': 0}

    print(f'[SENTIMENT] refreshing {len(films)} film(s)')
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _one(film):
        async with semaphore:
            try:
                return await refresh_film_sentiment(film)
            except Exception as e:
                print(f'[SENTIMENT] failed for "{film["title"]}": {e}')
                return None

    results = await asyncio.gather(*[_one(f) for f in films])
    updated = sum(1 for r in results if r)
    print(f'[SENTIMENT] done: {updated}/{len(films)} updated')
    return {'checked': len(films), 'updated': updated}
