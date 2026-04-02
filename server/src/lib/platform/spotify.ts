import { requestWithRetry } from '../requestWithRetry';
import {
  fetchEnrichmentMaps,
  type EnrichmentTrack,
} from '../enrichment';
import type {
  PlatformAdapter,
  PlatformPlaylist,
  PlatformTrack,
  PlatformTrackMeta,
  AuthResult,
  TokenRefreshResult,
} from './types';

// ─── Shared helpers ────────────────────────────────────────────────────────────

// Splits an array into fixed-size chunks.
// Used to batch track URIs for Spotify write endpoints (100-URI cap per request).
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Returns the Base64-encoded "client_id:client_secret" credential string.
// Spotify requires this in the Authorization header for token exchange and refresh calls.
const spotifyBasicAuth = (): string =>
  'Basic ' +
  Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

// Merges raw Spotify track data with enrichment maps to produce a normalized PlatformTrack.
// audioFeaturesMap is keyed by platformId (which equals the Spotify track ID for Spotify).
const buildTrack = (
  rawTrack: any,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>
): PlatformTrack => {
  const features = audioFeaturesMap[rawTrack.id] || {};
  const genres = artistGenreMap[rawTrack.artists[0].id] || [];

  return {
    id: rawTrack.id,
    name: rawTrack.name,
    artist: rawTrack.artists[0].name,
    albumName: rawTrack.album.name,
    albumImageUrl: rawTrack.album.images[0]?.url ?? null,
    durationMs: rawTrack.duration_ms,
    releaseYear: rawTrack.album.release_date
      ? parseInt(rawTrack.album.release_date.substring(0, 4))
      : null,
    genres,
    audioFeatures: {
      energy: features.energy ?? null,
      danceability: features.danceability ?? null,
      valence: features.valence ?? null,
      acousticness: features.acousticness ?? null,
      instrumentalness: features.instrumentalness ?? null,
      speechiness: features.speechiness ?? null,
      tempo: features.tempo ?? null,
    },
  };
};

// ─── SpotifyAdapter ─────────────────────────────────────────────────────────────

// Implements PlatformAdapter for Spotify.
// All Spotify-specific API details live here — routes and middleware only call the interface.
export class SpotifyAdapter implements PlatformAdapter {
  readonly platform = 'SPOTIFY' as const;
  readonly trackCacheIdField  = 'spotifyId';
  readonly artistCacheIdField = 'spotifyArtistId';

  // Builds the Spotify OAuth authorization URL the user is redirected to when clicking "Connect".
  // The `show_dialog: true` flag forces the consent screen even if the user has logged in before.
  getAuthUrl(): string {
    const scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private',
      'user-read-private',
      'user-read-email',
      'user-library-read',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: `${process.env.SERVER_URL}/auth/spotify/callback`,
      scope: scopes,
      show_dialog: 'true',
    });

    return `https://accounts.spotify.com/authorize?${params}`;
  }

  // Exchanges a one-time OAuth authorization code for access + refresh tokens.
  // Fetches the user's Spotify profile in the same step to build a complete AuthResult.
  async exchangeCode(code: string): Promise<AuthResult> {
    const tokenResponse = await requestWithRetry(
      'post',
      'https://accounts.spotify.com/api/token',
      {
        headers: {
          Authorization: spotifyBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.SERVER_URL}/auth/spotify/callback`,
      }),
      3,
      'Spotify auth'
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    const profileResponse = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/me',
      { headers: { Authorization: `Bearer ${access_token}` } },
      undefined,
      3,
      'Spotify'
    );

    const { id, display_name, email } = profileResponse.data;

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
      platformUserId: id,
      displayName: display_name,
      email: email ?? null,
    };
  }

  // Uses a stored refresh token to obtain a new Spotify access token.
  // Called by the token refresh middleware and by getValidAccessToken in the cron.
  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const response = await requestWithRetry(
      'post',
      'https://accounts.spotify.com/api/token',
      {
        headers: {
          Authorization: spotifyBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      3,
      'Spotify auth'
    );

    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  // Fetches all playlists owned or followed by the authenticated user (up to 50).
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const response = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/me/playlists',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 50 },
      },
      undefined,
      3,
      'Spotify'
    );

    return response.data.items
      .filter((p: any) => p !== null)
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        trackCount: p.items?.total ?? 0,  //DO NOT CHANGE ITEMS INTO TRACKS IN THIS LINE!
        imageUrl: p.images?.[0]?.url ?? null,
        ownerId: p.owner.id,
      }));
  }

  // Fetches metadata for a single Spotify playlist by its ID.
  // Used when a user discovers a playlist they don't own via URL paste.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    const response = await requestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      undefined,
      3,
      'Spotify'
    );

    const p = response.data;
    return {
      id: p.id,
      name: p.name,
      ownerId: p.owner.id,
      trackCount: p.tracks?.total ?? 0,
      imageUrl: p.images?.[0]?.url ?? null,
    };
  }

  // Fetches one page of tracks from a playlist, enriched with audio features and genres.
  // page=0 returns tracks 0–49, page=1 returns 50–99, and so on.
  // signal is forwarded into requestWithRetry so the platform API call is cancelled
  // immediately when the client drops the HTTP connection.
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number,
    signal?: AbortSignal
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    const tracksResponse = await requestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      },
      undefined,
      3,
      'Spotify',
      signal
    );

    // Filter out null entries and non-track items (e.g. podcast episodes)
    const items = tracksResponse.data.items.filter((item: any) => {
      const track = item.item || item.track;
      return track !== null && track !== undefined && track.type === 'track';
    });

    const rawTracks = items.map((item: any) => item.item || item.track);

    // For Spotify, platformId === spotifyId — the Spotify track ID is used for both
    // cache storage (platformId) and ReccoBeats lookup (spotifyId).
    // isrc is stored so that if the same recording appears later on another platform
    // (e.g. SoundCloud), the cache can be reused without a second ReccoBeats call.
    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: t.id,
      spotifyId: t.id,
      idField: this.trackCacheIdField,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
      isrc: t.external_ids?.isrc ?? undefined,
      platform: 'SPOTIFY' as const,
    }));

    // Fire background enrichment for cache misses — don't block the response.
    // Features will be null on this load but arrive via the /features polling endpoint.
    const { audioFeaturesMap, artistGenreMap } = await fetchEnrichmentMaps(enrichmentInput);

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total: tracksResponse.data.total };
  }

  // Returns the total number of tracks in the user's Liked Songs library.
  // Uses a limit=1 request so no actual track data is transferred — just the total count.
  async fetchLikedCount(accessToken: string): Promise<number> {
    const response = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/me/tracks',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 1 },
      },
      undefined,
      3,
      'Spotify'
    );
    return response.data.total;
  }

  // Fetches one page of enriched tracks from the user's Liked Songs.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    const tracksResponse = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/me/tracks',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      },
      undefined,
      3,
      'Spotify'
    );

    const items = tracksResponse.data.items.filter(
      (item: any) => item.track !== null && item.track.type === 'track'
    );

    const rawTracks = items.map((item: any) => item.track);

    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: t.id,
      spotifyId: t.id,
      idField: this.trackCacheIdField,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
      isrc: t.external_ids?.isrc ?? undefined,
      platform: 'SPOTIFY' as const,
    }));

    const { audioFeaturesMap, artistGenreMap } = await fetchEnrichmentMaps(enrichmentInput);

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total: tracksResponse.data.total };
  }

  // Fetches every track across all pages without audio-feature enrichment.
  // Returns only the data the shuffle algorithms need — avoids expensive ReccoBeats calls.
  // Used exclusively by the auto-reshuffle cron.
  async fetchAllTracksMeta(
    accessToken: string,
    playlistId: string
  ): Promise<PlatformTrackMeta[]> {
    const tracks: PlatformTrackMeta[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await requestWithRetry(
        'get',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit, offset },
        },
        undefined,
        3,
        'Spotify'
      );

      const rawItems = response.data.items || [];
      const validItems = rawItems.filter((item: any) => {
        const track = item?.item ?? item?.track;
        return track && track.type === 'track';
      });

      tracks.push(
        ...validItems.map((item: any) => {
          const track = item.item ?? item.track;
          return {
            id: track.id,
            artist: track.artists[0].name,
            genres: [], // genres not needed for shuffle algorithms in the cron
            releaseYear: track.album.release_date
              ? parseInt(track.album.release_date.substring(0, 4))
              : null,
          };
        })
      );

      if (offset + limit >= response.data.total) break;
      offset += limit;
    }

    return tracks;
  }

  // Creates a new empty playlist in the user's Spotify account and follows it.
  //
  // Why the follow call is necessary:
  //   POST /v1/me/playlists creates the playlist but does not automatically add it
  //   to the user's Spotify library sidebar. PUT /v1/playlists/{id}/followers is the
  //   explicit "add to library" step — without it the playlist exists on Spotify but
  //   is invisible until the user manually searches for it.
  async createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }> {
    const response = await requestWithRetry(
      'post',
      'https://api.spotify.com/v1/me/playlists',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { name, description, public: true },
      3,
      'Spotify'
    );

    const { id, owner } = response.data;

    // Follow the newly created playlist so it appears in the user's library.
    // This call is fire-and-forget — a failure here is non-fatal since the playlist
    // was created successfully; the user can always follow it manually from Spotify.
    await requestWithRetry(
      'put',
      `https://api.spotify.com/v1/playlists/${id}/followers`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
      { public: false },
      3,
      'Spotify'
    ).catch(err =>
      console.warn(`Spotify follow-playlist failed for ${id}:`, err.response?.status ?? err.message)
    );

    return { id, ownerId: owner.id };
  }

  // Replaces the entire content of a Spotify playlist with a new ordered track list.
  // Handles Spotify's 100-URI-per-request limit:
  //   - First request: PUT (replaces everything with the first 100 tracks)
  //   - Subsequent: POST (appends remaining chunks)
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const uris = trackIds.map(id => this.formatTrackUri(id));
    const firstChunk = uris.slice(0, 100);
    const remainingChunks = chunkArray(uris.slice(100), 100);

    await requestWithRetry(
      'put',
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
      { uris: firstChunk },
      3,
      'Spotify'
    );

    for (const chunk of remainingChunks) {
      await requestWithRetry(
        'post',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
        { uris: chunk },
        3,
        'Spotify'
      );
    }
  }

  // Appends tracks to an existing Spotify playlist without replacing existing content.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const uris = trackIds.map(id => this.formatTrackUri(id));
    const chunks = chunkArray(uris, 100);

    for (const chunk of chunks) {
      await requestWithRetry(
        'post',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        { uris: chunk },
        3,
        'Spotify'
      );
    }
  }

  // Converts a raw Spotify track ID into a Spotify URI.
  // Spotify write endpoints require URIs in the format "spotify:track:<id>".
  formatTrackUri(trackId: string): string {
    return `spotify:track:${trackId}`;
  }

  // Paginates through the user's Spotify library to check whether a playlist is still present.
  // Returns true on any error — the cleanup cron should never delete a schedule on uncertainty.
  async playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean> {
    let offset = 0;
    const limit = 20;

    try {
      while (true) {
        const response = await requestWithRetry(
          'get',
          'https://api.spotify.com/v1/me/playlists',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { limit, offset },
          },
          undefined,
          3,
          'Spotify'
        );

        const items: any[] = response.data.items ?? [];
        if (items.some((p: any) => p?.id === playlistId)) return true;
        if (offset + limit >= response.data.total) return false;
        offset += limit;
      }
    } catch {
      return true; // network/5xx — assume it still exists
    }
  }

  // Accepts a Spotify playlist URL or a raw 22-character alphanumeric ID.
  // Spotify IDs are always exactly 22 chars — no other format ambiguity exists.
  extractPlaylistId(input: string): string | null {
    const trimmed = input.trim();
    const urlMatch = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
    return null;
  }
}
