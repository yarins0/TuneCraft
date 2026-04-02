import type { PlatformConfig } from './types';

// How many test users Spotify allows in developer mode.
// Update this value if Spotify changes their policy.
const SPOTIFY_DEV_USER_LIMIT = 5;

// Client-side config for Spotify.
// Mirrors the server-side SpotifyAdapter — presentation data and URL logic only, no API calls.
export const spotifyConfig: PlatformConfig = {
  label:  'Spotify',
  icon:   '🎵',
  cssVar: '--color-platform-spotify',

  available:              true,
  requiresAccessRequest:  true,
  accessRequest: {
    userLimit:     SPOTIFY_DEV_USER_LIMIT,
    emailLabel:    'Spotify Email',
    continueLabel: 'Continue to Spotify',
    description:
      `Tunecraft is in developer mode. Spotify limits developer apps to ${SPOTIFY_DEV_USER_LIMIT} approved users — ` +
      'only people manually added to the allowlist can log in.',
  },
  ownershipRestricted:        true,  // Spotify API blocks reading playlists owned by other users
  followedPlaylistsSupported: true,  // me/playlists returns both owned and followed playlists
  totalTracksReliable:    true,
  audioFeaturesMissingHint: undefined,

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
