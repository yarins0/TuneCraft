import type { PlatformConfig } from './types';

// Client-side config for Spotify.
// Mirrors the server-side SpotifyAdapter — presentation data and URL logic only, no API calls.
export const spotifyConfig: PlatformConfig = {
  label:  'Spotify',
  icon:   '🎵',
  cssVar: '--color-platform-spotify',

  trackUrl: id => `https://open.spotify.com/track/${id}`,

  playlistUrl: id =>
    id === 'liked'
      ? 'https://open.spotify.com/collection/tracks'
      : `https://open.spotify.com/playlist/${id}`,

  // Accepts a full Spotify playlist URL or a raw 22-character alphanumeric ID.
  // Spotify IDs are always exactly 22 chars — no other format ambiguity exists.
  extractPlaylistId: input => {
    const urlMatch = input.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{22}$/.test(input)) return input;
    return null;
  },
};
