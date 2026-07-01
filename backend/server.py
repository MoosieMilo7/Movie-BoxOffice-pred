import os
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db.database import db
from .routes.films import router as films_router

_start_time = time.time()

app = FastAPI(title='Box Office Predictor', version='2.0.0')

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
