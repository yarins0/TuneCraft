import type { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import { calculateAverages } from '../lib/playlistHelpers';
import type { Platform } from '../lib/platform/types';

// GET /playlists/:userId
// Fetches all playlists for the authenticated user.
export const getPlaylists = async (req: Request, res: Response): Promise<void> => {
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);

  try {
    const playlists = await adapter.fetchPlaylists(accessToken);

    res.json({
      playlists: playlists.map(p => ({
        platformId: p.id,
        name:       p.name,
        trackCount: p.trackCount,
        imageUrl:   p.imageUrl,
        ownerId:    p.ownerId,
        platform:   adapter.platform,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
};

// GET /playlists/:userId/features?ids=id1,id2,...
// Returns cached audio features for specific track IDs — reads DB only, no external API calls.
// Used by the client to poll for features being fetched in the background.
export const getFeatures = async (req: Request, res: Response): Promise<void> => {
  const ids = ((req.query.ids as string) || '').split(',').filter(Boolean);
  if (ids.length === 0) {
    res.json({ features: {} });
    return;
  }

  const adapter = getAdapter(req.userPlatform as Platform);
  // The adapter declares which TrackCache column holds its native track IDs.
  // No if/else chain needed — adding a new platform only requires updating the adapter.
  const idField = adapter.trackCacheIdField;

  try {
    // Query the correct column and select it back so we can map results to platform IDs.
    const cached = await prisma.trackCache.findMany({
      where:  { [idField]: { in: ids } },
      select: { [idField]: true, audioFeatures: true },
    });

    const features: Record<string, Record<string, unknown>> = {};
    cached.forEach(entry => {
      const nativeId = (entry as any)[idField] as string | null;
      if (!nativeId) return;

      const f: Record<string, unknown> =
        typeof entry.audioFeatures === 'string'
          ? JSON.parse(entry.audioFeatures)
          : (entry.audioFeatures as Record<string, unknown>);
      const { href, ...rest } = f;
      features[nativeId] = rest;
    });

    res.json({ features });
  } catch (error) {
    console.error('Failed to fetch cached features:', error);
    res.status(500).json({ error: 'Failed to fetch features' });
  }
};

// GET /playlists/:userId/genres?names=artist1,artist2,...
// Returns cached genre tags for a list of artist names — reads ArtistCache only, no external calls.
// Artist names are matched case-insensitively via the normalizedName column.
export const getGenres = async (req: Request, res: Response): Promise<void> => {
  const names = ((req.query.names as string) || '').split(',').filter(Boolean);
  if (names.length === 0) {
    res.json({ genres: {} });
    return;
  }

  // Normalize to match the ArtistCache normalizedName column (lowercase + trimmed)
  const normalizedNames = names.map((n: string) => n.toLowerCase().trim());

  try {
    const cached = await prisma.artistCache.findMany({
      where:  { normalizedName: { in: normalizedNames } },
      select: { normalizedName: true, genres: true },
    });

    const genres: Record<string, string[]> = {};
    cached.forEach(entry => {
      if (entry.normalizedName) {
        genres[entry.normalizedName] = entry.genres as string[];
      }
    });

    res.json({ genres });
  } catch (error) {
    console.error('Failed to fetch cached genres:', error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
};

// GET /playlists/:userId/liked
// Fetches the Liked Songs count for the dashboard card.
// Liked Songs are not included in the regular playlists endpoint — they need a separate call.
export const getLiked = async (req: Request, res: Response): Promise<void> => {
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);

  try {
    const trackCount = await adapter.fetchLikedCount(accessToken);

    res.json({
      playlist: {
        platformId: 'liked',
        name:       'Liked Songs',
        trackCount,
        imageUrl:   null,
        isLiked:    true,
        platform:   adapter.platform,
      },
    });
  } catch (error: any) {
    console.error('Failed to fetch liked songs:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked songs' });
  }
};

// GET /playlists/:userId/liked/tracks
// Fetches a single page of enriched tracks from the user's Liked Songs.
// Supports pagination via ?page= query parameter.
export const getLikedTracks = async (req: Request, res: Response): Promise<void> => {
  const accessToken = req.accessToken;
  const adapter     = getAdapter(req.userPlatform as Platform);
  const page  = Math.max(0, Math.min(parseInt(req.query.page as string) || 0, 1000));
  const limit = 50;

  try {
    const { tracks, total, hasMore: adapterHasMore } =
      await adapter.fetchLikedTracks(accessToken, page);

    const tracksWithPlatform = tracks.map(t => ({ ...t, platform: adapter.platform }));

    // Prefer hasMore from the adapter (set by cursor-based adapters like Tidal that can't
    // reliably derive it from total). Fall back to the page*limit formula for offset adapters.
    const hasMore = adapterHasMore ?? (page * limit + tracks.length < total);

    res.json({
      tracks: tracksWithPlatform,
      playlistAverages: calculateAverages(tracks),
      total,
      hasMore,
      nextPage: page + 1,
    });
  } catch (error: any) {
    console.error('Failed to fetch liked tracks:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked tracks' });
  }
};
