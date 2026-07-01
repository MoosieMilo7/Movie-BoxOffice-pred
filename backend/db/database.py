import sqlite3
import os
import threading
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv('DB_PATH', './db/boxoffice.db')
_p = Path(DB_PATH)
resolved = _p if _p.is_absolute() else Path.cwd() / _p
resolved.parent.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(str(resolved), check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute('PRAGMA journal_mode=WAL')
db.execute('PRAGMA foreign_keys=ON')

_lock = threading.Lock()

db.executescript("""
  CREATE TABLE IF NOT EXISTS films (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id                 INTEGER UNIQUE NOT NULL,
    title                   TEXT NOT NULL,
    overview                TEXT,
    market                  TEXT,
    status                  TEXT,
    release_date            TEXT,
    budget                  INTEGER DEFAULT 0,
    revenue                 INTEGER DEFAULT 0,
    runtime                 INTEGER,
    genres                  TEXT,
    cast_top5               TEXT,
    director                TEXT,
    production_companies    TEXT,
    production_countries    TEXT,
    original_language       TEXT,
    poster_path             TEXT,
    trailer_url             TEXT,
    belongs_to_collection   TEXT,
    mpaa_rating             TEXT,
    vote_average            REAL DEFAULT 0,
    vote_count              INTEGER DEFAULT 0,
    popularity              REAL DEFAULT 0,
    budget_inferred         INTEGER DEFAULT 0,
    budget_source           TEXT,
    last_tmdb_sync          TEXT,
    last_apify_sync         TEXT,
    created_at              TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sentiment_snapshots (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id                 INTEGER REFERENCES films(id) ON DELETE CASCADE,
    scraped_at              TEXT,
    sentiment_score         INTEGER,
    sentiment_label         TEXT,
    sentiment_one_line      TEXT,
    trailer_view_count      INTEGER DEFAULT 0,
    raw_mention_count       INTEGER DEFAULT 0,
    previous_mention_count  INTEGER DEFAULT 0,
    mention_velocity        REAL DEFAULT 0,
    snapshot_data           TEXT
  );

  CREATE TABLE IF NOT EXISTS comp_anchors (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    upcoming_film_id        INTEGER REFERENCES films(id) ON DELETE CASCADE,
    comp_film_id            INTEGER REFERENCES films(id) ON DELETE CASCADE,
    similarity_score        REAL,
    match_reasons           TEXT,
    comp_actual_ow_origin   REAL,
    comp_actual_ow_global   REAL,
    created_at              TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS talent_scores (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_person_id          INTEGER UNIQUE,
    name                    TEXT,
    role                    TEXT,
    film_count              INTEGER DEFAULT 0,
    avg_ow_when_leading     REAL DEFAULT 0,
    hit_rate                REAL DEFAULT 0,
    market                  TEXT,
    last_updated            TEXT
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id                 INTEGER REFERENCES films(id) ON DELETE CASCADE,
    generated_at            TEXT,
    days_until_release      INTEGER,
    structural_score        REAL,
    sentiment_score         REAL,
    momentum_score          REAL,
    market_score            REAL,
    comp_score              REAL,
    final_score             REAL,
    origin_ow_low           REAL,
    origin_ow_mid           REAL,
    origin_ow_high          REAL,
    origin_country          TEXT,
    origin_currency         TEXT,
    origin_ow_local_low     REAL,
    origin_ow_local_mid     REAL,
    origin_ow_local_high    REAL,
    global_ow_low           REAL,
    global_ow_mid           REAL,
    global_ow_high          REAL,
    confidence              TEXT,
    confidence_reason       TEXT,
    key_drivers             TEXT,
    risk_factors            TEXT,
    comp_films_used         TEXT,
    analyst_report          TEXT,
    methodology_version     TEXT DEFAULT 'v2.0'
  );

  CREATE INDEX IF NOT EXISTS idx_films_tmdb       ON films(tmdb_id);
  CREATE INDEX IF NOT EXISTS idx_films_status     ON films(status);
  CREATE INDEX IF NOT EXISTS idx_films_market     ON films(market);
  CREATE INDEX IF NOT EXISTS idx_sentiment_film   ON sentiment_snapshots(film_id);
  CREATE INDEX IF NOT EXISTS idx_comp_upcoming    ON comp_anchors(upcoming_film_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_film ON predictions(film_id);
""")

# Add columns that may not exist in older DB files (idempotent)
for _col_sql in [
    'ALTER TABLE films ADD COLUMN watch_providers_json TEXT',
    'ALTER TABLE films ADD COLUMN watch_providers_synced_at TEXT',
]:
    try:
        db.execute(_col_sql)
    except sqlite3.OperationalError:
        pass

print(f'[db] SQLite connected → {resolved}')
print('[db] schema ready')


def fetchone(sql, params=()):
    row = db.execute(sql, params).fetchone()
    return dict(row) if row else None


def fetchall(sql, params=()):
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def execute_write(sql, params=()):
    with _lock:
        cur = db.execute(sql, params)
        return cur.lastrowid


def executemany_write(sql, params_list):
    with _lock:
        db.executemany(sql, params_list)
