import { Router } from 'express';
import axios from 'axios';
import prisma from '../lib/prisma';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import { applyShuffle } from '../lib/shuffleAlgorithms';

const router = Router();

// Splits an array into chunks of a given size.
// Reused here to batch Spotify API calls when writing reshuffled track order.
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// POST /reshuffle/:userId/:spotifyId
// Enables auto-reshuffle for a playlist, or updates existing settings.
// Uses upsert so the same endpoint works for both create and update.
router.post('/:userId/:spotifyId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const spotifyId = req.params.spotifyId as string;
  const { intervalDays, algorithms, playlistName } = req.body;

  // Validate that intervalDays is a positive number
  if (!intervalDays || intervalDays < 1) {
    return res.status(400).json({ error: 'intervalDays must be at least 1' });
  }

  try {
    // Calculate when the first auto-reshuffle should happen
    const nextReshuffleAt = new Date();
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + intervalDays);

    // upsert: update if a record already exists for this user+playlist, create if not
    const playlist = await prisma.playlist.upsert({
      where: {
        userId_spotifyPlaylistId: {
          userId,
          spotifyPlaylistId: spotifyId,
        },
      },
      update: {
        autoReshuffle: true,
        intervalDays,
        algorithms,
        nextReshuffleAt,
        name: playlistName,
      },
      create: {
        userId,
        spotifyPlaylistId: spotifyId,
        name: playlistName,
        autoReshuffle: true,
        intervalDays,
        algorithms,
        nextReshuffleAt,
      },
    });

    res.json({ success: true, playlist });
  } catch (error: any) {
    console.error('Failed to enable auto-reshuffle:', error);
    res.status(500).json({ error: 'Failed to enable auto-reshuffle' });
  }
});

// DELETE /reshuffle/:userId/:spotifyId
// Disables auto-reshuffle for a playlist.
// We update the record rather than delete it so we keep the history.
router.delete('/:userId/:spotifyId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const spotifyId = req.params.spotifyId as string;

  try {
    await prisma.playlist.updateMany({
      where: {
        userId,
        spotifyPlaylistId: spotifyId,
      },
      data: {
        autoReshuffle: false,
        nextReshuffleAt: null,
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to disable auto-reshuffle:', error);
    res.status(500).json({ error: 'Failed to disable auto-reshuffle' });
  }
});

// GET /reshuffle/:userId
// Returns all active auto-reshuffle settings for a user.
// Used to display the auto-reshuffle status on the playlist detail page.
router.get('/:userId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;

  try {
    const playlists = await prisma.playlist.findMany({
      where: {
        userId,
        autoReshuffle: true,
      },
      select: {
        spotifyPlaylistId: true,
        name: true,
        intervalDays: true,
        algorithms: true,
        lastReshuffledAt: true,
        nextReshuffleAt: true,
      },
    });

    res.json({ playlists });
  } catch (error: any) {
    console.error('Failed to fetch auto-reshuffles:', error);
    res.status(500).json({ error: 'Failed to fetch auto-reshuffles' });
  }
});

export default router;
