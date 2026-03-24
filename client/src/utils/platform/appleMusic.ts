import type { PlatformConfig } from './types';

// Client-side config for Apple Music.
// Adapter not yet built — URL formats and extractPlaylistId are stubs.
// Fill these in when the Apple Music adapter is implemented on the server.
export const appleMusicConfig: PlatformConfig = {
  label:  'Apple Music',
  icon:   '🍎',
  cssVar: '--color-platform-apple-music',

  available:              false, // Adapter not yet built
  ownershipRestricted:    false,
  totalTracksReliable:    true,
  audioFeaturesMissingHint: undefined,

  trackUrl: id => `https://music.apple.com/us/song/${id}`,

  playlistUrl: id =>
    id === 'liked'
      ? 'https://music.apple.com/us/library/recently-added'
      : `https://music.apple.com/us/playlist/${id}`,

  // Not yet implemented — fill in when Apple Music adapter is built
  extractPlaylistId: () => null,
};
