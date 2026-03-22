import type { PlatformConfig } from './types';

// Client-side config for SoundCloud.
// Mirrors the server-side SoundCloudAdapter — presentation data and URL logic only, no API calls.
export const soundcloudConfig: PlatformConfig = {
  label:  'SoundCloud',
  icon:   '🔊',
  cssVar: '--color-platform-soundcloud',

  available:              false,
  ownershipRestricted:    false,
  totalTracksReliable:    true,
  // Independent SoundCloud uploads often lack an ISRC, which means ReccoBeats can't be reached
  // for them — audio features will be missing for a large share of indie-heavy playlists.
  audioFeaturesMissingHint: "This often happens with independent SoundCloud uploads that aren't on major streaming services.",

  trackUrl: id => `https://soundcloud.com/tracks/${id}`,

  playlistUrl: id =>
    id === 'liked'
      ? 'https://soundcloud.com/you/likes'
      : `https://soundcloud.com/playlists/${id}`,

  // SoundCloud playlist URLs: soundcloud.com/username/sets/playlist-name
  // The slug cannot be resolved to a numeric ID client-side — we return a normalised
  // https:// URL as a signal to the caller that the server's /resolve?url=... is needed.
  extractPlaylistId: input => {
    const match = input.match(
      /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^/?#]+)\/sets\/([^/?#]+)/
    );
    return match ? `https://soundcloud.com/${match[1]}/sets/${match[2]}` : null;
  },
};
