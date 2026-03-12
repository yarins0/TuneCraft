import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import playlistsRouter from './routes/playlists';
import reshuffleRouter from './routes/reshuffle';
import { startReshuffleCron } from './lib/reshuffleCron';

// Environment variables must be loaded before any other configuration
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware runs on every incoming request before it reaches any route
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes are mounted with a base path prefix
app.use('/auth', authRouter);
app.use('/playlists', playlistsRouter);
app.use('/reshuffle', reshuffleRouter);

startReshuffleCron();

// Health check endpoint used to verify the server is running
app.get('/health', (req, res) => {
  res.json({ status: 'Tunecraft server is running 🎛️' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});