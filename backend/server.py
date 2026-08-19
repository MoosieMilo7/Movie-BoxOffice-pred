import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .db.database import db
from .routes.films import router as films_router
from .services.sentiment_tracker import refresh_due_sentiment, REFRESH_INTERVAL_HOURS

_start_time = time.time()
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        refresh_due_sentiment, 'interval', hours=REFRESH_INTERVAL_HOURS,
        next_run_time=datetime.now(timezone.utc), id='sentiment_refresh',
    )
    scheduler.start()
    print(f'[server] sentiment tracker scheduled every {REFRESH_INTERVAL_HOURS}h')
    yield
    scheduler.shutdown()


app = FastAPI(title='Box Office Predictor', version='2.0.0', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/api/health')
def health():
    try:
        db.execute('SELECT 1')
        db_status = 'connected'
    except Exception:
        db_status = 'error'
    return {
        'status':    'ok' if db_status == 'connected' else 'degraded',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'db':        db_status,
        'uptime':    round(time.time() - _start_time, 2),
    }


app.include_router(films_router, prefix='/api/films')

if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', 3001))
    print(f'[server] listening on http://localhost:{port}')
    uvicorn.run('backend.server:app', host='0.0.0.0', port=port, reload=True)
