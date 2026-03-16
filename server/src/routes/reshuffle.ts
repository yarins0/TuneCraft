import { Router } from 'express';
import axios from 'axios';
import prisma from '../lib/prisma';
import { refreshTokenMiddleware } from '../middleware/refreshToken';

const router = Router();

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

    res.json({ success: true, schedule: playlist });
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
        spotifyPlaylistId: true,
        name: true,
        intervalDays: true,
        algorithms: true,
        lastReshuffledAt: true,
        nextReshuffleAt: true,
      },
    });

    const validPlaylists: typeof playlists = [];

    for (const playlist of playlists) {
      try {
        // Verify the playlist still exists on Spotify and refresh its name
        const spotifyResponse: any = await axios.get(
          `https://api.spotify.com/v1/playlists/${playlist.spotifyPlaylistId}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { fields: 'id,name' },
          }
        );

        const spotifyName = spotifyResponse.data.name as string | undefined;
        let updatedPlaylist = playlist;

        if (spotifyName && spotifyName !== playlist.name) {
          await prisma.playlist
            .updateMany({
              where: {
                userId,
                spotifyPlaylistId: playlist.spotifyPlaylistId,
              },
              data: {
                name: spotifyName,
              },
            })
            .catch(() => {});

          updatedPlaylist = {
            ...playlist,
            name: spotifyName,
          };
        }

        validPlaylists.push(updatedPlaylist);
      } catch (error: any) {
        const status = error.response?.status;

        if (status === 404 || status === 403) {
          // Playlist was deleted or is no longer accessible on Spotify — remove its auto-reshuffle entry
          await prisma.playlist
            .deleteMany({
              where: {
                userId,
                spotifyPlaylistId: playlist.spotifyPlaylistId,
              },
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
