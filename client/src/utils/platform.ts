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

  // SoundCloud playlist URLs look like: soundcloud.com/username/sets/playlist-name
  // The slug can't be resolved client-side — the server calls GET /resolve?url=... to
  // translate it to a numeric ID. We return the normalized https:// URL as a signal
  // to the caller that it needs server-side resolution (not a direct platform ID).
  const scMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^/?#]+)\/sets\/([^/?#]+)/);
  if (scMatch) {
    return `https://soundcloud.com/${scMatch[1]}/sets/${scMatch[2]}`;
  }

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
    case 'SOUNDCLOUD':
      return `https://soundcloud.com/tracks/${trackId}`;
    case 'TIDAL':
      return `https://tidal.com/browse/track/${trackId}`;
    // case 'APPLE_MUSIC':
    //   return `https://music.apple.com/us/song/${trackId}`;
    default:
      return `https://open.spotify.com/track/${trackId}`;
  }
};

// Returns the external URL to open a playlist on its native platform.
// The 'liked' pseudo-ID is handled specially — it maps to each platform's liked/saved library.
export const getPlatformPlaylistUrl = (
  platform: string | undefined,
  playlistId: string
): string => {
  switch ((platform ?? 'SPOTIFY').toUpperCase()) {
    case 'SPOTIFY':
      return playlistId === 'liked'
        ? 'https://open.spotify.com/collection/tracks'
        : `https://open.spotify.com/playlist/${playlistId}`;
    case 'SOUNDCLOUD':
      return playlistId === 'liked'
        ? 'https://soundcloud.com/you/likes'
        : `https://soundcloud.com/playlists/${playlistId}`;
    case 'TIDAL':
      return playlistId === 'liked'
        ? 'https://tidal.com/browse/my-collection/tracks'
        : `https://tidal.com/browse/playlist/${playlistId}`;
    default:
      return playlistId === 'liked'
        ? 'https://open.spotify.com/collection/tracks'
        : `https://open.spotify.com/playlist/${playlistId}`;
  }
};

// Returns a human-readable label for the "Open in …" tooltip/title attribute.
export const getPlatformLabel = (platform: string | undefined): string => {
  switch ((platform ?? 'SPOTIFY').toUpperCase()) {
    case 'SPOTIFY':
      return 'Open in Spotify';
    case 'SOUNDCLOUD':
      return 'Open in SoundCloud';
    case 'TIDAL':
      return 'Open in Tidal';
    case 'APPLE_MUSIC':
      return 'Open in Apple Music';
    default:
      return 'Open in Spotify';
  }
};
