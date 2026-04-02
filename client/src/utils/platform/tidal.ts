import type { PlatformConfig } from './types';

// Client-side config for Tidal.
// Mirrors the server-side TidalAdapter — presentation data and URL logic only, no API calls.
export const tidalConfig: PlatformConfig = {
  label:  'Tidal',
  icon:   '🌊',
  cssVar: '--color-platform-tidal',

  available:              true,
  requiresAccessRequest:  false,
  ownershipRestricted:        false,
  followedPlaylistsSupported: true,  // Tidal API returns both owned and followed playlists
  totalTracksReliable:    false, // Tidal's API often omits meta.total — fall back to dashboard count
  audioFeaturesMissingHint: undefined,

  trackUrl: id => `https://tidal.com/browse/track/${id}`,

  playlistUrl: id =>
    id === 'liked'
      ? 'https://tidal.com/browse/my-collection/tracks'
      : `https://tidal.com/browse/playlist/${id}`,

  // Accepts both Tidal playlist URL forms and raw UUIDs:
  //   https://tidal.com/browse/playlist/UUID
  //   https://listen.tidal.com/playlist/UUID
  //   UUID directly (8-4-4-4-12 hex groups, 36 chars) — same as pasting the ID from the Tidal app
  // The UUID is the direct playlist ID — no server-side resolution needed.
  extractPlaylistId: input => {
    const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
    const urlMatch = input.match(new RegExp(`tidal\\.com(?:\\/browse)?\\/playlist\\/${UUID}`));
    if (urlMatch) return urlMatch[1];
    if (new RegExp(`^${UUID}$`).test(input)) return input;
    return null;
  },
};
