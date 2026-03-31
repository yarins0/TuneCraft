import type { Request, Response } from 'express';
import { getAdapter } from '../lib/platform/registry';
import type { Platform } from '../lib/platform/types';

// Maps common platform HTTP error codes to client-facing messages.
const handlePlaylistFetchError = (error: any, res: Response, fallbackMessage: string): void => {
  const status = error.response?.status;
  if (status === 404) { res.status(404).json({ error: 'Playlist not found' }); return; }
  if (status === 403) { res.status(403).json({ error: 'This playlist is private' }); return; }
  res.status(500).json({ error: fallbackMessage });
};

// Shapes a fetched playlist into the standard discovery response object.
const formatPlaylistResponse = (playlist: any, platform: string) => ({
  platformId: playlist.id,
  name:       playlist.name,
  ownerId:    playlist.ownerId,
  trackCount: playlist.trackCount,
  imageUrl:   playlist.imageUrl,
  platform,
});

// GET /playlists/:userId/discover?url=<full-platform-url>
// Resolves a platform URL to a playlist for platforms where extractPlaylistId returns a URL
// rather than a bare ID (currently SoundCloud — slug URLs need server-side resolution).
export const discoverByUrl = async (req: Request, res: Response): Promise<void> => {
  const url = req.query.url as string | undefined;

  if (!url) {
    res.status(400).json({ error: 'url query param required' });
    return;
  }

  const adapter = getAdapter(req.userPlatform as Platform);

  try {
    const playlist = await adapter.fetchPlaylist(req.accessToken, url);
    res.json(formatPlaylistResponse(playlist, adapter.platform));
  } catch (error: any) {
    handlePlaylistFetchError(error, res, 'Failed to resolve playlist URL');
  }
};

// GET /playlists/:userId/discover/:playlistId
// Fetches metadata for any public playlist by ID.
// Used when a user pastes a URL or ID they don't own.
export const discoverById = async (req: Request, res: Response): Promise<void> => {
  const playlistId = req.params.playlistId as string;
  const adapter    = getAdapter(req.userPlatform as Platform);

  try {
    const playlist = await adapter.fetchPlaylist(req.accessToken, playlistId);
    res.json(formatPlaylistResponse(playlist, adapter.platform));
  } catch (error: any) {
    handlePlaylistFetchError(error, res, 'Failed to fetch playlist');
  }
};
