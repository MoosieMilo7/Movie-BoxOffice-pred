import os
import httpx
from dotenv import load_dotenv

load_dotenv()

APIFY_BASE = 'https://api.apify.com/v2'
YOUTUBE_ACTOR = 'streamers~youtube-scraper'


async def get_youtube_video_stats(video_url):
    token = os.getenv('APIFY_API_KEY')
    if not token:
        raise ValueError('APIFY_API_KEY not set')

    url = f'{APIFY_BASE}/acts/{YOUTUBE_ACTOR}/run-sync-get-dataset-items'
    payload = {
        'startUrls': [{'url': video_url}],
        'maxResults': 1, 'maxComments': 0,
        'maxResultsShorts': 0, 'maxResultStreams': 0,
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(url, params={'token': token}, json=payload)
        res.raise_for_status()
        items = res.json()

    if not items:
        return None

    v = items[0]
    return {
        'title':         v.get('title'),
        'view_count':    v.get('viewCount') or 0,
        'like_count':    v.get('likes') or 0,
        'comment_count': v.get('commentsCount') or 0,
        'channel_name':  v.get('channelName'),
        'published_at':  v.get('date'),
    }
