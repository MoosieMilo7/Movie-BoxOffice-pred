/**
 * One-time sentiment scrape for all upcoming films.
 * Run: node backend/scripts/run_sentiment_now.js
 */
import dotenv from 'dotenv';
dotenv.config();
import { runNow } from '../services/scheduler.js';

console.log('[SENTIMENT-NOW] Starting one-time scrape of all upcoming films...');
await runNow(0);
console.log('[SENTIMENT-NOW] Done.');
process.exit(0);
