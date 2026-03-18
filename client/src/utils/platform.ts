// ─── Playlist ID extraction ────────────────────────────────────────────────────

// Extracts a playlist ID from either a full URL or a raw ID, and detects the platform.
// Returns null if the input doesn't match any known format.
//
// Supported formats:
//   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
//   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123
//   37i9dQZF1DXcBWIGoYBM5M  (raw Spotify ID — 22 alphanumeric characters)
export const extractPlaylistId = (input: string): string | null => {
  const trimmed = input.trim();

  // Spotify full URL
  if (trimmed.includes('spotify.com/playlist/')) {
    const match = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  // Raw Spotify ID (22 alphanumeric characters)
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }

  // Future platforms can add their URL patterns here, e.g.:
  //   if (trimmed.includes('soundcloud.com/')) { ... }

  return null;
};

// ─── Platform-aware track URLs ─────────────────────────────────────────────────

// Returns the external URL to open a track on its native platform.
// Falls back to Spotify if the platform is unknown — keeps the app functional
// even if a future platform hasn't implemented its URL format yet.
export const getPlatformTrackUrl = (platform: string | undefined, trackId: string): string => {
  switch ((platform ?? 'SPOTIFY').toUpperCase()) {
    case 'SPOTIFY':
      return `https://open.spotify.com/track/${trackId}`;
    // Future platforms:
    // case 'SOUNDCLOUD':
    //   return `https://soundcloud.com/tracks/${trackId}`;
    // case 'APPLE_MUSIC':
    //   return `https://music.apple.com/us/song/${trackId}`;
    default:
      return `https://open.spotify.com/track/${trackId}`;
  }
};

// Returns a human-readable label for the "Open in …" tooltip/title attribute.
export const getPlatformLabel = (platform: string | undefined): string => {
  switch ((platform ?? 'SPOTIFY').toUpperCase()) {
    case 'SPOTIFY':
      return 'Open in Spotify';
    case 'SOUNDCLOUD':
      return 'Open in SoundCloud';
    case 'APPLE_MUSIC':
      return 'Open in Apple Music';
    default:
      return 'Open in Spotify';
  }
};
