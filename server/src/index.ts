/// <reference path="./types/express.d.ts" />
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import playlistsRouter from './routes/playlists';
import reshuffleRouter from './routes/reshuffle';
import { startCrons } from './lib/crons';

// Environment variables must be loaded before any other configuration
dotenv.config();

// Fail fast if required secrets are missing — a server without HMAC_SECRET would silently
// accept all requests without identity verification.
if (!process.env.HMAC_SECRET) {
  console.error('FATAL: HMAC_SECRET env var is not set. Add it to server/.env and restart.');
  process.exit(1);
}

if (!process.env.FRONTEND_URL) {
  console.error('FATAL: FRONTEND_URL env var is not set. Without it, CORS allows all origins. Add it to server/.env and restart.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Global rate limit: 60 requests per minute per IP.
// Prevents brute-force and abuse across all endpoints.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Stricter limit for auth endpoints: 10 requests per minute per IP.
// Access-request and OAuth callbacks are the highest-value abuse targets.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests. Please slow down.' },
});

// Middleware runs on every incoming request before it reaches any route.
// CORS is restricted to the configured frontend origin — no other site can make
// authenticated requests to this server from a user's browser.
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json({ limit: '10mb' }));
app.use(globalLimiter);
app.use('/auth', authLimiter);

// Routes are mounted with a base path prefix
app.use('/auth', authRouter);
app.use('/playlists', playlistsRouter);
app.use('/reshuffle', reshuffleRouter);

startCrons();

// Health check endpoint used to verify the server is running
app.get('/health', (req, res) => {
  res.json({ status: 'Tunecraft server is running 🎛️' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});