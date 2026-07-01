"""
seed.py — One-time database population.

Phase 1: Upcoming films across 5 markets (with OW predictions)
Phase 2: Released films as comp anchors (high-revenue, multi-genre)

Run: python -m backend.db.seed
Safe to re-run: exits early if >50 films already present.
"""
import asyncio
import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# Ensure project root is on path when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / '.env')

from backend.db.database import db, execute_write, fetchone
from backend.services.tmdb import get_upcoming_films, get_film_details, get_released_films_for_comps
from backend.services.predictor import generate_prediction
from backend.services.film_mode import determine_film_mode

MARKETS = ['hollywood', 'bollywood', 'korean', 'japanese', 'european']
COMP_GENRES = [28, 16, 35, 18, 27, 878]  # Action, Animation, Comedy, Drama, Horror, Sci-Fi
MAX_PER_MARKET = 30
MAX_COMPS_PER_COMBO = 10

_UPSERT_SQL = '''
  INSERT INTO films (
    tmdb_id, title, overview, market, status, release_date,
    budget, revenue, runtime, genres, cast_top5, director,
    production_companies, production_countries, original_language,
    poster_path, trailer_url, belongs_to_collection, mpaa_rating,
    vote_average, vote_count, popularity,
    budget_inferred, budget_source, last_tmdb_sync
  ) VALUES (
    :tmdb_id, :title, :overview, :market, :status, :release_date,
    :budget, :revenue, :runtime, :genres, :cast_top5, :director,
    :production_companies, :production_countries, :original_language,
    :poster_path, :trailer_url, :belongs_to_collection, :mpaa_rating,
    :vote_average, :vote_count, :popularity,
    :budget_inferred, :budget_source, :last_tmdb_sync
  )
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title=excluded.title, overview=excluded.overview,
    market=excluded.market, status=excluded.status,
    release_date=excluded.release_date, budget=excluded.budget,
    revenue=excluded.revenue, runtime=excluded.runtime,
    genres=excluded.genres, cast_top5=excluded.cast_top5,
    director=excluded.director,
    production_companies=excluded.production_companies,
    production_countries=excluded.production_countries,
    original_language=excluded.original_language,
    poster_path=excluded.poster_path, trailer_url=excluded.trailer_url,
    belongs_to_collection=excluded.belongs_to_collection,
    mpaa_rating=excluded.mpaa_rating,
    vote_average=excluded.vote_average, vote_count=excluded.vote_count,
    popularity=excluded.popularity, budget_inferred=excluded.budget_inferred,
    budget_source=excluded.budget_source, last_tmdb_sync=excluded.last_tmdb_sync
'''


def _insert_film(row, status):
    execute_write(_UPSERT_SQL, {
        'tmdb_id':               row['tmdb_id'],
        'title':                 row['title'],
        'overview':              row.get('overview'),
        'market':                row.get('market') or 'hollywood',
        'status':                status,
        'release_date':          row.get('release_date'),
        'budget':                row.get('budget') or 0,
        'revenue':               row.get('revenue') or 0,
        'runtime':               row.get('runtime'),
        'genres':                json.dumps(row.get('genres') or []),
        'cast_top5':             json.dumps(row.get('cast_top5') or []),
        'director':              json.dumps(row.get('director')),
        'production_companies':  json.dumps(row.get('production_companies') or []),
        'production_countries':  json.dumps(row.get('production_countries') or []),
        'original_language':     row.get('original_language'),
        'poster_path':           row.get('poster_path'),
        'trailer_url':           row.get('trailer_url'),
        'belongs_to_collection': json.dumps(row['belongs_to_collection']) if row.get('belongs_to_collection') else None,
        'mpaa_rating':           row.get('mpaa_rating'),
        'vote_average':          row.get('vote_average') or 0,
        'vote_count':            row.get('vote_count') or 0,
        'popularity':            row.get('popularity') or 0,
        'budget_inferred':       1 if row.get('budget_inferred') else 0,
        'budget_source':         row.get('budget_source'),
        'last_tmdb_sync':        datetime.now(timezone.utc).isoformat(),
    })
    return fetchone('SELECT * FROM films WHERE tmdb_id=?', (row['tmdb_id'],))


def _already_in_db(tmdb_id):
    return bool(db.execute('SELECT id FROM films WHERE tmdb_id=?', (tmdb_id,)).fetchone())


async def main():
    film_count = db.execute('SELECT COUNT(*) AS count FROM films').fetchone()['count']
    if film_count > 50:
        print(f'[SEED] Database already seeded ({film_count} films). Skipping.')
        return

    # ── Phase 1: Upcoming films ──────────────────────────────────────
    seeded_upcoming = 0
    seeded_predictions = 0

    print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('PHASE 1 — Upcoming films (with OW predictions)')
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    for market in MARKETS:
        print(f'[SEED] Phase 1: {market} upcoming films')
        try:
            upcoming = await get_upcoming_films(market)
        except Exception as e:
            print(f'[SEED] get_upcoming_films({market}) failed: {e}')
            continue

        if not upcoming:
            continue
        print(f'[SEED] Found {len(upcoming)} upcoming {market} films')

        for candidate in upcoming[:MAX_PER_MARKET]:
            if _already_in_db(candidate['tmdb_id']):
                continue
            try:
                details = await get_film_details(candidate['tmdb_id'])
                if not details:
                    await asyncio.sleep(0.3)
                    continue
                mode = determine_film_mode(details)
                if not mode['predict']:
                    await asyncio.sleep(0.3)
                    continue
                film   = _insert_film(details, mode['mode'])
                result = await generate_prediction(film)
                ow     = result.get('prediction', {}).get('opening_weekend', {}).get('global', {})
                mid    = ow.get('mid_usd', '?')
                conf   = result.get('prediction', {}).get('confidence', '?')
                print(f'[SEED] ✅ {details["title"]} ({market}) → ${mid}M global OW [{conf}]')
                seeded_upcoming += 1
                if result.get('prediction'):
                    seeded_predictions += 1
            except Exception as e:
                print(f'[SEED] ❌ {candidate.get("title") or candidate["tmdb_id"]}: {e}')
            await asyncio.sleep(0.3)

    # ── Phase 2: Comp pool ───────────────────────────────────────────
    seeded_comps = 0

    print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('PHASE 2 — Comp pool (released films by genre)')
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    for market in MARKETS:
        for genre_id in COMP_GENRES:
            try:
                comps = await get_released_films_for_comps([genre_id], market, 100_000_000)
                if not comps:
                    continue
            except Exception as e:
                print(f'[SEED] get_released_films_for_comps({genre_id}, {market}) failed: {e}')
                continue

            for candidate in comps[:MAX_COMPS_PER_COMBO]:
                if _already_in_db(candidate['tmdb_id']):
                    continue
                try:
                    details = await get_film_details(candidate['tmdb_id'])
                    if not details or not (details.get('revenue') or 0) > 0:
                        await asyncio.sleep(0.3)
                        continue
                    _insert_film(details, 'released')
                    rev_m = (details.get('revenue') or 0) / 1_000_000
                    print(f'[SEED] 📦 Comp: {details["title"]} (${rev_m:.0f}M WW)')
                    seeded_comps += 1
                except Exception as e:
                    print(f'[SEED] ❌ comp {candidate["tmdb_id"]}: {e}')
                await asyncio.sleep(0.3)

    # ── Summary ──────────────────────────────────────────────────────
    totals = db.execute(
        '''SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('upcoming','in_production','fresh_release') THEN 1 ELSE 0 END) AS predictable,
                  SUM(CASE WHEN status='released' THEN 1 ELSE 0 END) AS comp_pool
           FROM films'''
    ).fetchone()
    pred_count = db.execute('SELECT COUNT(*) AS count FROM predictions').fetchone()['count']

    print(f'''
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEED COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total films:        {totals["total"]}
Predictable:        {totals["predictable"]}
Comp pool:          {totals["comp_pool"]}
Predictions stored: {pred_count}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
''')


if __name__ == '__main__':
    asyncio.run(main())
