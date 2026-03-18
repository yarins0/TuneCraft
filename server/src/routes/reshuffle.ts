import { Router } from 'express';
import prisma from '../lib/prisma';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import { getAdapter } from '../lib/platform/registry';
import type { Platform } from '../lib/platform/types';

const router = Router();

// POST /reshuffle/:userId/:playlistId
// Enables auto-reshuffle for a playlist, or updates existing settings.
// Uses upsert so the same endpoint works for both create and update.
router.post('/:userId/:playlistId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const playlistId = req.params.playlistId as string;
  const { intervalDays, algorithms, playlistName } = req.body;
  // Validate that intervalDays is a positive number
  if (!intervalDays || intervalDays < 1) {
    return res.status(400).json({ error: 'intervalDays must be at least 1' });
  }

  try {
    // The frontend applies and saves the shuffle itself using the already-loaded enriched
    // track list (genres + audio features), so there's no need to re-fetch tracks here.
    // This route only persists the schedule settings.
    // lastReshuffledAt is intentionally NOT set here — it is only written when an actual
    // shuffle occurs (shuffle route or save route). Setting it here would show a false
    // "last shuffled" date on playlists that were scheduled but never actually reshuffled.
    const now = new Date();
    const nextReshuffleAt = new Date(now);
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + intervalDays);

    // upsert: update if a record already exists for this user+playlist, create if not
    const playlist = await prisma.playlist.upsert({
      where: {
        userId_platformPlaylistId: {
          userId,
          platformPlaylistId: playlistId,
        },
      },
      update: {
        autoReshuffle: true,
        intervalDays,
        algorithms,
        nextReshuffleAt,
        name: playlistName,
        // lastReshuffledAt is not touched — preserve whatever the shuffle routes wrote last
      },
      create: {
        userId,
        platformPlaylistId: playlistId,
        name: playlistName,
        autoReshuffle: true,
        intervalDays,
        algorithms,
        lastReshuffledAt: null,
        nextReshuffleAt,
      },
    });

    res.json({ success: true, schedule: playlist });
  } catch (error: any) {
    console.error('Failed to enable auto-reshuffle:', error);
    res.status(500).json({ error: 'Failed to enable auto-reshuffle' });
  }
});

// DELETE /reshuffle/:userId/:playlistId
// Removes the auto-reshuffle schedule for a playlist entirely.
// Deletion is correct here — the cleanup cron only watches autoReshuffle=true records,
// so a disabled record would sit orphaned forever. The POST upsert recreates it if re-enabled.
router.delete('/:userId/:playlistId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const playlistId = req.params.playlistId as string;

  try {
    await prisma.playlist.deleteMany({
      where: {
        userId,
        platformPlaylistId: playlistId,
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
// Also performs light cleanup: if Spotify reports that a scheduled playlist
// is gone or inaccessible (404/403), the corresponding DB record is removed.
router.get('/:userId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const accessToken = (req as any).accessToken;

  try {
    const playlists = await prisma.playlist.findMany({
      where: {
        userId,
        autoReshuffle: true,
      },
      select: {
        platformPlaylistId: true,
        name: true,
        intervalDays: true,
        algorithms: true,
        lastReshuffledAt: true,
        nextReshuffleAt: true,
      },
    });

    const adapter = getAdapter((req as any).userPlatform as Platform);
    const validPlaylists: typeof playlists = [];

    for (const playlist of playlists) {
      try {
        // Verify the playlist still exists on the platform and refresh its name if it changed
        const fetched = await adapter.fetchPlaylist(accessToken, playlist.platformPlaylistId);
        let updatedPlaylist = playlist;

        if (fetched.name && fetched.name !== playlist.name) {
          await prisma.playlist
            .updateMany({
              where: { userId, platformPlaylistId: playlist.platformPlaylistId },
              data: { name: fetched.name },
            })
            .catch(() => {});

          updatedPlaylist = { ...playlist, name: fetched.name };
        }

        validPlaylists.push(updatedPlaylist);
      } catch (error: any) {
        const status = error.response?.status;

        if (status === 404 || status === 403) {
          // Playlist was deleted or is no longer accessible — remove its auto-reshuffle entry
          await prisma.playlist
            .deleteMany({
              where: { userId, platformPlaylistId: playlist.platformPlaylistId },
            })
            .catch(() => {});
          continue;
        }

        // On other errors (e.g. transient network issues), keep the entry
        validPlaylists.push(playlist);
      }
    }

    res.json({ schedules: validPlaylists });
  } catch (error: any) {
    console.error('Failed to fetch auto-reshuffles:', error);
    res.status(500).json({ error: 'Failed to fetch auto-reshuffles' });
  }
});

export default router;
