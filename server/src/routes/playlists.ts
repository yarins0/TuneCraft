import { Router } from 'express';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import type { Platform } from '../lib/platform/types';

const router = Router();

// A serial write queue keyed by userId.
// Platform rate limits apply per OAuth token — each user has their own rolling window.
// Serializing per user prevents a single user's concurrent requests from colliding
// without blocking writes for other users.
const writeQueues = new Map<string, Promise<void>>();

const enqueueWrite = <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
  const current = writeQueues.get(userId) ?? Promise.resolve();
  const result = current.then(fn);
  // After settling (success or error), remove the entry so the Map doesn't grow indefinitely.
  // .finally() runs regardless of outcome — identical to the two-handler .then(f, f) pattern.
  // Uses reference identity of `tail` to avoid deleting a newer entry that replaced this one.
  // Cast to Promise<void> — the queue only needs something to chain from, not the resolved value
  const tail = result.finally(() => {
    if (writeQueues.get(userId) === tail) writeQueues.delete(userId);
  }) as Promise<void>;
  writeQueues.set(userId, tail);
  return result;
};

// Calculates the average value of each audio feature across all tracks in a page.
// Used to display playlist-level stats in the track list UI.
const calculateAverages = (tracks: any[]) => {
  const average = (key: string) => {
    const values = tracks
      .map((t: any) => t.audioFeatures[key])
      .filter((v: any) => v !== null);
    return values.length
      ? Math.round((values.reduce((a: number, b: number) => a + b, 0) / values.length) * 100) / 100
      : null;
  };

  return {
    energy: average('energy'),
    danceability: average('danceability'),
    valence: average('valence'),
    acousticness: average('acousticness'),
    instrumentalness: average('instrumentalness'),
    speechiness: average('speechiness'),
    tempo: Math.round(
      tracks.reduce((sum: number, t: any) => sum + (t.audioFeatures.tempo ?? 0), 0) / tracks.length
    ),
  };
};

// GET /playlists/:userId
// Fetches all playlists for the authenticated user
router.get('/:userId', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const playlists = await adapter.fetchPlaylists(accessToken);

    // Map to the legacy response shape the client expects (uses spotifyId key)
    res.json({
      playlists: playlists.map(p => ({
        spotifyId: p.id,
        name: p.name,
        trackCount: p.trackCount,
        imageUrl: p.imageUrl,
        ownerId: p.ownerId,
        platform: adapter.platform,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// GET /playlists/:userId/discover/:playlistId
// Fetches metadata for any public playlist by ID
// Used when a user pastes a URL or ID they don't own
router.get('/:userId/discover/:playlistId', refreshTokenMiddleware, async (req, res) => {
  const playlistId = req.params.playlistId as string;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const playlist = await adapter.fetchPlaylist(accessToken, playlistId);

    res.json({
      spotifyId: playlist.id,
      name: playlist.name,
      ownerId: playlist.ownerId,
      trackCount: playlist.trackCount,
      imageUrl: playlist.imageUrl,
      platform: adapter.platform,
    });
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 404) return res.status(404).json({ error: 'Playlist not found' });
    if (status === 403) return res.status(403).json({ error: 'This playlist is private' });
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// GET /playlists/:userId/features?ids=id1,id2,...
// Returns cached audio features for specific track IDs — reads DB only, no external API calls.
// Used by the client to poll for features being fetched in the background.
router.get('/:userId/features', refreshTokenMiddleware, async (req, res) => {
  const ids = ((req.query.ids as string) || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.json({ features: {} });

  try {
    const cached = await prisma.trackCache.findMany({
      where: { platformTrackId: { in: ids } },
      select: { platformTrackId: true, audioFeatures: true },
    });

    const features: Record<string, any> = {};
    cached.forEach(entry => {
      const f = typeof entry.audioFeatures === 'string'
        ? JSON.parse(entry.audioFeatures)
        : entry.audioFeatures as any;
      const { href, ...rest } = f;
      features[entry.platformTrackId] = rest;
    });

    res.json({ features });
  } catch (error) {
    console.error('Failed to fetch cached features:', error);
    res.status(500).json({ error: 'Failed to fetch features' });
  }
});

// GET /playlists/:userId/liked
// Fetches the Liked Songs count for the dashboard card
// Liked Songs are not included in the regular playlists endpoint — they need a separate call
router.get('/:userId/liked', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const trackCount = await adapter.fetchLikedCount(accessToken);

    res.json({
      playlist: {
        spotifyId: 'liked',
        name: 'Liked Songs',
        trackCount,
        imageUrl: null,
        isLiked: true,
        platform: adapter.platform,
      },
    });
  } catch (error: any) {
    console.error('Failed to fetch liked songs:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked songs' });
  }
});

// GET /playlists/:userId/liked/tracks
// Fetches a single page of enriched tracks from the user's Liked Songs
// Supports pagination via ?page= query parameter
router.get('/:userId/liked/tracks', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);
  const page = parseInt(req.query.page as string) || 0;
  const limit = 50;

  try {
    const { tracks, total } = await adapter.fetchLikedTracks(accessToken, page);
    const tracksWithPlatform = tracks.map(t => ({ ...t, platform: adapter.platform }));

    res.json({
      tracks: tracksWithPlatform,
      playlistAverages: calculateAverages(tracks),
      total,
      hasMore: page * limit + tracks.length < total,
      nextPage: page + 1,
    });
  } catch (error: any) {
    console.error('Failed to fetch liked tracks:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked tracks' });
  }
});

// GET /playlists/:userId/:spotifyId/tracks
// Fetches a single page of enriched tracks for a playlist
// Supports pagination via ?page= query parameter
router.get('/:userId/:spotifyId/tracks', refreshTokenMiddleware, async (req, res) => {
  const spotifyId = req.params.spotifyId as string;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);
  const page = parseInt(req.query.page as string) || 0;
  const limit = 50;

  try {
    const { tracks, total } = await adapter.fetchPlaylistTracks(accessToken, spotifyId, page);
    const tracksWithPlatform = tracks.map(t => ({ ...t, platform: adapter.platform }));

    res.json({
      tracks: tracksWithPlatform,
      playlistAverages: calculateAverages(tracks),
      total,
      hasMore: page * limit + tracks.length < total,
      nextPage: page + 1,
    });
  } catch (error: any) {
    console.error('Failed to fetch tracks:', error.response?.data || error.message);

    if (error.response?.status === 403) {
      return res.status(403).json({
        error: "This playlist can't be accessed. Spotify restricts access to playlists owned by other users in development mode.",
      });
    }

    res.status(500).json({ error: 'Failed to fetch playlist tracks' });
  }
});

// POST /playlists/:userId/:spotifyId/shuffle
// Saves a pre-shuffled track order to an owned playlist.
// The shuffle algorithm runs on the frontend — this route only writes the result to the platform.
router.post('/:userId/:spotifyId/shuffle', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const spotifyId = req.params.spotifyId as string;
  const { tracks } = req.body;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const trackIds = tracks.map((t: any) => t.id);

    await enqueueWrite(userId, () =>
      adapter.replacePlaylistTracks(accessToken, spotifyId, trackIds)
    );

    // If auto-reshuffle is scheduled for this playlist, reset the timestamps so the cron
    // doesn't re-shuffle immediately after a manual shuffle.
    // Defined as a named async function and called without await — intentionally fire-and-forget.
    // A failure here doesn't roll back the shuffle result.
    const updateReshuffleTimestamps = async () => {
      const schedule = await prisma.playlist.findUnique({
        where: { userId_platformPlaylistId: { userId, platformPlaylistId: spotifyId } },
        select: { autoReshuffle: true, intervalDays: true },
      });
      if (!schedule?.autoReshuffle || !schedule.intervalDays) return;
      const now = new Date();
      const nextReshuffleAt = new Date(now);
      nextReshuffleAt.setDate(nextReshuffleAt.getDate() + schedule.intervalDays);
      await prisma.playlist.update({
        where: { userId_platformPlaylistId: { userId, platformPlaylistId: spotifyId } },
        data: { lastReshuffledAt: now, nextReshuffleAt },
      });
    };
    updateReshuffleTimestamps().catch(err => {
      console.error('Failed to update reshuffle timestamps after manual shuffle:', err);
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.response?.status === 404) {
      // Playlist was deleted from Spotify — clean up the orphaned schedule record
      await prisma.playlist.deleteMany({
        where: { userId, platformPlaylistId: spotifyId },
      }).catch(dbErr => console.error('Failed to remove deleted playlist from DB:', dbErr));
      return res.status(404).json({ error: 'Playlist not found — it may have been deleted' });
    }

    console.error('Failed to shuffle playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to shuffle playlist' });
  }
});

// POST /playlists/:userId/copy
// Creates a new playlist as a copy of any playlist — including ones the user doesn't own
router.post('/:userId/copy', refreshTokenMiddleware, async (req, res) => {
  const { tracks, name } = req.body;
  const userId = req.params.userId as string;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const trackIds = tracks.map((t: any) => t.id);

    const { id: newPlaylistId, ownerId } = await enqueueWrite(userId, async () => {
      const playlist = await adapter.createPlaylist(accessToken, name, 'Created by Tunecraft');
      await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
      return playlist;
    });

    res.json({
      success: true,
      playlist: { spotifyId: newPlaylistId, name, ownerId, platform: adapter.platform },
    });
  } catch (error: any) {
    console.error('Failed to copy playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to copy playlist' });
  }
});

// POST /playlists/:userId/merge
// Creates a new playlist from a pre-built merged track list.
// The frontend handles fetching + deduplication — this route only writes the final list.
router.post('/:userId/merge', refreshTokenMiddleware, async (req, res) => {
  const { tracks, name } = req.body;
  const userId = req.params.userId as string;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const trackIds = tracks.map((t: any) => t.id);

    const { id: newPlaylistId, ownerId } = await enqueueWrite(userId, async () => {
      const playlist = await adapter.createPlaylist(accessToken, name, 'Merged by Tunecraft');
      await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
      return playlist;
    });

    res.json({
      success: true,
      playlist: { spotifyId: newPlaylistId, name, ownerId, platform: adapter.platform },
    });
  } catch (error: any) {
    console.error('Failed to merge playlists:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to merge playlists' });
  }
});

// POST /playlists/:userId/split
// Receives an array of named groups — creates one new playlist per group.
// Each group's tracks are sent by the frontend after running the split algorithm client-side.
router.post('/:userId/split', refreshTokenMiddleware, async (req, res) => {
  const { groups } = req.body as {
    groups: { name: string; tracks: { id: string }[]; description: string }[];
  };
  const userId = req.params.userId as string;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const created = await enqueueWrite(userId, async () => {
      const results = [];

      // Process groups sequentially to avoid hammering the platform API
      for (const group of groups) {
        const playlist = await adapter.createPlaylist(
          accessToken,
          group.name,
          `${group.description} - Created by TuneCraft Split`
        );
        const trackIds = group.tracks.map((t: any) => t.id);
        await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
        results.push({ spotifyId: playlist.id, name: group.name, ownerId: playlist.ownerId, platform: adapter.platform });
      }

      return results;
    });

    res.json({ success: true, playlists: created });
  } catch (error: any) {
    console.error('Failed to split playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to split playlist' });
  }
});

// PUT /playlists/:userId/:spotifyId/save
// Saves the current track order to an owned playlist.
// Identical to shuffle's write path — both replace the full playlist with a new ordered list.
router.put('/:userId/:spotifyId/save', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const spotifyId = req.params.spotifyId as string;
  const { tracks } = req.body;
  const accessToken = (req as any).accessToken;
  const adapter = getAdapter((req as any).userPlatform as Platform);

  try {
    const trackIds = tracks.map((t: any) => t.id);

    await enqueueWrite(userId, () =>
      adapter.replacePlaylistTracks(accessToken, spotifyId, trackIds)
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to save playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to save playlist' });
  }
});

export default router;
