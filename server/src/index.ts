/// <reference path="./types/express.d.ts" />
import express from 'express';
import cors from 'cors';
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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware runs on every incoming request before it reaches any route.
// CORS is restricted to the configured frontend origin — no other site can make
// authenticated requests to this server from a user's browser.
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json({ limit: '10mb' }));

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