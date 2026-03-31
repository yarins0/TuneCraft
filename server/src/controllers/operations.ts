import type { Request, Response } from 'express';
import { getAdapter } from '../lib/platform/registry';
import { enqueueWrite } from '../lib/playlistHelpers';
import type { Platform } from '../lib/platform/types';

// Validates that a name field, if present and a string, does not exceed 200 characters.
// Returns true if invalid (response already sent), false if valid.
const rejectLongName = (name: unknown, res: Response): boolean => {
  if (typeof name === 'string' && name.length > 200) {
    res.status(400).json({ error: 'Playlist name must be 200 characters or fewer' });
    return true;
  }
  return false;
};

// POST /playlists/:userId/copy
// Creates a new playlist as a copy of any playlist — including ones the user doesn't own.
export const copyPlaylist = async (req: Request, res: Response): Promise<void> => {
  const { tracks, name } = req.body;
  const userId           = req.params.userId as string;
  const accessToken      = req.accessToken;
  const adapter          = getAdapter(req.userPlatform as Platform);

  if (!Array.isArray(tracks)) {
    res.status(400).json({ error: 'tracks must be an array' });
    return;
  }
  if (rejectLongName(name, res)) return;

  try {
    const trackIds = tracks.map((t: { id: string }) => t.id);

    const { id: newPlaylistId, ownerId } = await enqueueWrite(userId, async () => {
      const playlist = await adapter.createPlaylist(accessToken, name, 'Created by Tunecraft');
      await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
      return playlist;
    });

    res.json({
      success:  true,
      playlist: { platformId: newPlaylistId, name, ownerId, platform: adapter.platform },
    });
  } catch (error: any) {
    console.error('Failed to copy playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to copy playlist' });
  }
};

// POST /playlists/:userId/merge
// Creates a new playlist from a pre-built merged track list.
// The frontend handles fetching + deduplication — this route only writes the final list.
export const mergePlaylist = async (req: Request, res: Response): Promise<void> => {
  const { tracks, name } = req.body;
  const userId           = req.params.userId as string;
  const accessToken      = req.accessToken;
  const adapter          = getAdapter(req.userPlatform as Platform);

  if (!Array.isArray(tracks)) {
    res.status(400).json({ error: 'tracks must be an array' });
    return;
  }
  if (rejectLongName(name, res)) return;

  try {
    const trackIds = tracks.map((t: { id: string }) => t.id);

    const { id: newPlaylistId, ownerId } = await enqueueWrite(userId, async () => {
      const playlist = await adapter.createPlaylist(accessToken, name, 'Merged by Tunecraft');
      await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
      return playlist;
    });

    res.json({
      success:  true,
      playlist: { platformId: newPlaylistId, name, ownerId, platform: adapter.platform },
    });
  } catch (error: any) {
    console.error('Failed to merge playlists:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to merge playlists' });
  }
};

// POST /playlists/:userId/split
// Receives an array of named groups — creates one new playlist per group.
// Each group's tracks are sent by the frontend after running the split algorithm client-side.
export const splitPlaylist = async (req: Request, res: Response): Promise<void> => {
  const { groups } = req.body as {
    groups: { name: string; tracks: { id: string }[]; description: string }[];
  };
  const userId      = req.params.userId as string;
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);

  if (!Array.isArray(groups) || groups.length === 0) {
    res.status(400).json({ error: 'groups must be a non-empty array' });
    return;
  }
  if (groups.some(g => typeof g.name === 'string' && g.name.length > 200)) {
    res.status(400).json({ error: 'Playlist name must be 200 characters or fewer' });
    return;
  }

  try {
    const created = await enqueueWrite(userId, async () => {
      const results = [];

      // Process groups sequentially to avoid hammering the platform API.
      for (const group of groups) {
        const playlist = await adapter.createPlaylist(
          accessToken,
          group.name,
          `${group.description} - Created by TuneCraft Split`
        );
        const trackIds = group.tracks.map((t: { id: string }) => t.id);
        await adapter.addTracksToPlaylist(accessToken, playlist.id, trackIds);
        results.push({
          platformId: playlist.id,
          name:       group.name,
          ownerId:    playlist.ownerId,
          platform:   adapter.platform,
        });
      }

      return results;
    });

    res.json({ success: true, playlists: created });
  } catch (error: any) {
    console.error('Failed to split playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to split playlist' });
  }
};
