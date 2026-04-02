import type { PlatformConfig } from './types';

// How many test users Google allows in OAuth consent screen test mode.
// Update this value if Google changes their policy.
const YOUTUBE_TEST_USER_LIMIT = 100;

// Client-side config for YouTube / YouTube Music.
// YouTube Music playlists are standard YouTube playlists — there is no separate
// YouTube Music API, so both YouTube and YouTube Music share this config.
export const youtubeConfig: PlatformConfig = {
  label:  'YouTube Music',
  icon:   '▶',
  cssVar: '--color-platform-youtube',

  available:             false,
  requiresAccessRequest: true,
  accessRequest: {
    userLimit:     YOUTUBE_TEST_USER_LIMIT,
    emailLabel:    'Google Account Email',
    continueLabel: 'Continue to YouTube Music',
    description:
      `Tunecraft is in test mode on Google. YouTube limits test apps to ${YOUTUBE_TEST_USER_LIMIT} approved users — ` +
      'only people manually added to the allowlist can log in.',
  },
  ownershipRestricted:        false,
  // YouTube Data API v3 only returns user-owned playlists (mine=true). Followed/saved
  // playlists from other channels are not exposed by any official OAuth-accessible endpoint.
  followedPlaylistsSupported: false,
  totalTracksReliable: true,

  // YouTube doesn't include ISRC in API responses, so audio features can only be
  // populated when the enrichment pipeline can resolve a Spotify ID via MusicBrainz.
  // Most tracks will have no feature data — this hint is shown in PlaylistDetail.
  audioFeaturesMissingHint:
    'YouTube Music doesn\'t provide track metadata needed for audio analysis. ' +
    'Features are only available for tracks that can be matched to Spotify via a shared ISRC.',

  trackUrl: id => `https://music.youtube.com/watch?v=${id}`,

  playlistUrl: id =>
    id === 'liked'
      ? 'https://music.youtube.com/playlist?list=LM'
      : `https://music.youtube.com/playlist?list=${id}`,

  // Accepts a YouTube or YouTube Music playlist URL (both use the same `list=` parameter)
  // or a raw playlist ID starting with "PL" (34 alphanumeric characters).
  extractPlaylistId: input => {
    const urlMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^PL[a-zA-Z0-9_-]{32}$/.test(input.trim())) return input.trim();
    return null;
  },
};
