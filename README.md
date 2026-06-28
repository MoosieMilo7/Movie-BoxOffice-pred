# CineMetric — Box Office Intelligence Platform

AI-powered opening weekend predictor for film acquisition analysts and streaming rights buyers.

## Stack
- **Backend** — Node.js / Express / SQLite (better-sqlite3)
- **Frontend** — React 18 / Vite / Tailwind CSS / Framer Motion
- **AI** — Anthropic Claude (`claude-sonnet-4-6`) for analyst reports & performance analysis
- **Data** — TMDB API · Apify (YouTube view counts) · Exchange Rate API

## Quick Start

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Copy and fill in credentials
cp .env.example .env

# 3. Seed the database (~500 films, takes 5-15 min)
node backend/db/seed.js

# 4. Start backend (port 3001)
node backend/server.js

# 5. Start frontend (port 5173)
cd frontend && npm run dev
```

Open **http://localhost:5173**

## Environment Variables

| Key | Description |
|-----|-------------|
| `TMDB_API_KEY` | TMDB v3 API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `APIFY_API_KEY` | Apify API key (YouTube view counts) |
| `EXCHANGE_RATE_API_KEY` | ExchangeRate-API key (optional, has fallback) |
| `PORT` | Backend port (default: 3001) |

## Architecture

```
boxoffice-predictor/
├── backend/
│   ├── server.js              # Express app + scheduler
│   ├── db/
│   │   ├── database.js        # SQLite connection + helpers
│   │   ├── migrations.js      # Schema + idempotent migrations
│   │   └── seed.js            # 500-film initial seed
│   ├── services/
│   │   ├── tmdb.js            # TMDB API client
│   │   ├── apify.js           # Social sentiment pipeline
│   │   ├── predictor.js       # 5-dimension scoring engine + Claude
│   │   ├── scheduler.js       # Cron jobs (6h/weekly/monthly)
│   │   ├── filmMode.js        # released vs upcoming detection
│   │   └── scoring/
│   │       ├── structural.js  # Budget · franchise · genre · talent · MPAA
│   │       ├── sentiment.js   # Apify snapshot → 0-1 score
│   │       ├── momentum.js    # Mention velocity · trailer views
│   │       ├── market.js      # Season · competition window
│   │       ├── comps.js       # Comp-anchored OW estimation
│   │       └── confidence.js  # Data availability → confidence tier
│   └── routes/
│       └── films.js           # REST API endpoints
└── frontend/
    └── src/
        ├── App.jsx
        └── components/
            ├── Navbar.jsx
            ├── Hero.jsx
            ├── FilmRows.jsx
            ├── FilmCard.jsx
            └── FilmDetail.jsx
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/films/search?q=` | Search + predict |
| GET | `/api/films/upcoming?market=` | Home screen rows |
| GET | `/api/films/:tmdb_id` | Film detail |
| GET | `/api/films/:tmdb_id/refresh` | Force refresh |

## Scoring Model (v2.0)

| Dimension | Weight | Source |
|-----------|--------|--------|
| Structural | 25% | Budget tier · franchise · genre · talent |
| Sentiment | 30% | Apify scrape → Claude scoring |
| Momentum | 20% | Mention velocity · trailer view growth |
| Market | 10% | Season · release window competition |
| Comps | 15% | Weighted average from similar films |

Released films show **actual** box office stats + streaming availability instead of predictions.
