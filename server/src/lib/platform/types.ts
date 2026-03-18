// Platform identifies which streaming service a resource belongs to.
// Values match the Prisma Platform enum — keep them in sync if you add new platforms.
export type Platform = 'SPOTIFY' | 'SOUNDCLOUD' | 'APPLE_MUSIC';

// A playlist with enough data to render a dashboard card.
// Uses a generic `id` field — routes map it to the legacy `spotifyId` response key as needed.
export interface PlatformPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
  ownerId: string;
  trackCount: number;
}

// A fully enriched track — audio features (via ReccoBeats) and genre tags (via Last.fm) attached.
// This is the shape returned by adapter read methods and consumed by route handlers.
export interface PlatformTrack {
  id: string;
  name: string;
  artist: string;
  albumName: string;
  albumImageUrl: string | null;
  durationMs: number;
  releaseYear: number | null;
  genres: string[];
  audioFeatures: {
    energy: number | null;
    danceability: number | null;
    valence: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    speechiness: number | null;
    tempo: number | null;
  };
}

// Minimal track data — enough for shuffle algorithms, without expensive audio-feature enrichment.
// Used by the auto-reshuffle cron so it doesn't have to hit ReccoBeats for every track.
export interface PlatformTrackMeta {
  id: string;
  artist: string;
  genres: string[];
  releaseYear: number | null;
}

// Returned by exchangeCode after a successful OAuth code exchange.
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  platformUserId: string; // the platform's own user ID (e.g. Spotify's "id" field)
  displayName: string;
  email: string | null;
}

// Returned by refreshAccessToken after a successful token refresh.
export interface TokenRefreshResult {
  accessToken: string;
  expiresAt: Date;
}

// Every streaming platform adapter must implement this interface.
// Routes and middleware call these methods instead of talking to any specific platform's API.
// To add a new platform: implement this interface, register the adapter in registry.ts — done.
export interface PlatformAdapter {
  readonly platform: Platform;

  // --- Auth ---

  // Returns the full OAuth authorization URL to redirect the user to.
  getAuthUrl(): string;

  // Exchanges a temporary OAuth code for long-lived access + refresh tokens.
  // Also fetches the user's profile from the platform to populate AuthResult.
  exchangeCode(code: string): Promise<AuthResult>;

  // Uses a stored refresh token to obtain a new access token when the current one expires.
  refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult>;

  // --- Read ---

  // Fetches all playlists owned or followed by the authenticated user.
  fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]>;

  // Fetches metadata for a single playlist by its platform ID.
  // Used when a user pastes a playlist URL they don't own (discovery flow).
  fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist>;

  // Fetches one page of enriched tracks from a playlist.
  // page=0 → first 50 tracks, page=1 → next 50, etc.
  fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }>;

  // Returns the total track count in the user's liked/saved library.
  // Lightweight — does not return track data.
  fetchLikedCount(accessToken: string): Promise<number>;

  // Fetches one page of enriched liked/saved tracks.
  fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }>;

  // Fetches ALL tracks in a playlist across all pages, with minimal data (no enrichment).
  // Used by the auto-reshuffle cron — avoids the overhead of audio-feature lookups.
  fetchAllTracksMeta(accessToken: string, playlistId: string): Promise<PlatformTrackMeta[]>;

  // --- Write ---

  // Creates a new empty playlist and returns its generated ID and owner's platform ID.
  createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }>;

  // Replaces the entire track list of a playlist with a new ordered list.
  // Handles chunking internally — platform limits vary (e.g. Spotify caps PUT at 100 URIs).
  replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void>;

  // Appends tracks to an existing playlist without replacing what's already there.
  addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void>;

  // Converts a raw track ID into the platform-specific URI format used for write operations.
  // Example: Spotify uses "spotify:track:<id>".
  formatTrackUri(trackId: string): string;

  // Returns true if the given playlist is still present in the user's library (owned or followed).
  // Used by the cleanup cron to detect playlists the user deleted or unfollowed.
  // Must return true on any network/API error — never delete a schedule on uncertainty.
  playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean>;
}
