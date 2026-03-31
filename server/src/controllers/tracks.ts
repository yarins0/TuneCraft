import type { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import { calculateAverages, enqueueWrite } from '../lib/playlistHelpers';
import type { Platform } from '../lib/platform/types';

// Resets the reshuffle schedule timestamps after a manual write so the cron doesn't
// immediately overwrite the user's intentional change before the next interval elapses.
// Called fire-and-forget — a failure here does not roll back the playlist write.
const resetReshuffleTimestamps = (userId: string, playlistId: string, context: string): void => {
  const update = async () => {
    const schedule = await prisma.playlist.findUnique({
      where:  { userId_platformPlaylistId: { userId, platformPlaylistId: playlistId } },
      select: { autoReshuffle: true, intervalDays: true },
    });
    if (!schedule?.autoReshuffle || !schedule.intervalDays) return;
    const now            = new Date();
    const nextReshuffleAt = new Date(now);
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + schedule.intervalDays);
    await prisma.playlist.update({
      where: { userId_platformPlaylistId: { userId, platformPlaylistId: playlistId } },
      data:  { lastReshuffledAt: now, nextReshuffleAt },
    });
  };
  update().catch(err =>
    console.error(`Failed to update reshuffle timestamps after ${context}:`, err)
  );
};

// GET /playlists/:userId/:playlistId/tracks
// Fetches a single page of enriched tracks for a playlist.
// Supports pagination via ?page= query parameter.
export const getTracks = async (req: Request, res: Response): Promise<void> => {
  const playlistId  = req.params.playlistId as string;
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);
  const page  = Math.max(0, Math.min(parseInt(req.query.page as string) || 0, 1000));
  const limit = 50;

  // Abort the in-flight platform API call if the client closes the connection
  // (tab closed, navigation away) so we stop consuming API quota for nobody.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const result             = await adapter.fetchPlaylistTracks(accessToken, playlistId, page, abortController.signal);
    const { tracks, total }  = result;
    const tracksWithPlatform = tracks.map(t => ({ ...t, platform: adapter.platform }));

    // Use the adapter-provided hasMore when present (e.g. Tidal, which returns 20 refs/page
    // regardless of page[size]=50 so the page*limit formula would be wrong).
    const hasMore = (result as any).hasMore ?? (page * limit + tracks.length < total);

    res.json({
      tracks: tracksWithPlatform,
      playlistAverages: calculateAverages(tracks),
      total,
      hasMore,
      nextPage: page + 1,
    });
  } catch (error: any) {
    console.error('Failed to fetch tracks:', error.response?.data || error.message);

    if (error.response?.status === 403) {
      res.status(403).json({
        error: "This playlist can't be accessed. Spotify restricts access to playlists owned by other users in development mode.",
      });
      return;
    }

    res.status(500).json({ error: 'Failed to fetch playlist tracks' });
  }
};

// POST /playlists/:userId/:playlistId/shuffle
// Saves a pre-shuffled track order to an owned playlist.
// The shuffle algorithm runs on the frontend — this route only writes the result to the platform.
export const shuffleTracks = async (req: Request, res: Response): Promise<void> => {
  const userId      = req.params.userId as string;
  const playlistId  = req.params.playlistId as string;
  const { tracks }  = req.body;
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);

  if (!Array.isArray(tracks)) {
    res.status(400).json({ error: 'tracks must be an array' });
    return;
  }

  try {
    const trackIds = tracks.map((t: { id: string }) => t.id);
    await enqueueWrite(userId, () =>
      adapter.replacePlaylistTracks(accessToken, playlistId, trackIds)
    );
    resetReshuffleTimestamps(userId, playlistId, 'manual shuffle');
    res.json({ success: true });
  } catch (error: any) {
    if (error.response?.status === 404) {
      // Playlist was deleted from the platform — clean up the orphaned schedule record.
      await prisma.playlist.deleteMany({
        where: { userId, platformPlaylistId: playlistId },
      }).catch(dbErr => console.error('Failed to remove deleted playlist from DB:', dbErr));
      res.status(404).json({ error: 'Playlist not found — it may have been deleted' });
      return;
    }
    console.error('Failed to shuffle playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to shuffle playlist' });
  }
};

// PUT /playlists/:userId/:playlistId/save
// Saves the current track order to an owned playlist.
// Identical write path to shuffle — both replace the full playlist with a new ordered list.
export const saveTracks = async (req: Request, res: Response): Promise<void> => {
  const userId      = req.params.userId as string;
  const playlistId  = req.params.playlistId as string;
  const { tracks }  = req.body;
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);

  if (!Array.isArray(tracks)) {
    res.status(400).json({ error: 'tracks must be an array' });
    return;
  }

  try {
    const trackIds = tracks.map((t: { id: string }) => t.id);
    await enqueueWrite(userId, () =>
      adapter.replacePlaylistTracks(accessToken, playlistId, trackIds)
    );
    resetReshuffleTimestamps(userId, playlistId, 'manual save');
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to save playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to save playlist' });
  }
};
