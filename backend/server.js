import express from 'express';
import dotenv  from 'dotenv';

dotenv.config();

// database.js creates all tables on first import.
import db from './db/database.js';
import filmsRouter           from './routes/films.js';
import { startScheduler }    from './services/scheduler.js';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  let dbStatus = 'connected';
  try { db.prepare('SELECT 1').get(); } catch { dbStatus = 'error'; }
  res.json({
    status:    dbStatus === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date(),
    db:        dbStatus,
    uptime:    process.uptime(),
  });
});

app.use('/api/films', filmsRouter);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  // Start scheduled sentiment scrapes (6h / weekly / monthly)
  startScheduler();
});