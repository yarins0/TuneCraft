import crypto from 'crypto';
import { requestWithRetry } from '../requestWithRetry';
import {
  readEnrichmentCache,
  backgroundEnrichTracks,
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

// ─── Constants ────────────────────────────────────────────────────────────────

const TIDAL_AUTH_URL  = 'https://login.tidal.com/authorize';
const TIDAL_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_V1    = 'https://api.tidal.com/v1';
const TIDAL_API_V2    = 'https://api.tidal.com/v2';

// Scopes registered on the Tidal developer dashboard for this app.
const TIDAL_SCOPES = [
  'user.read',
  'collection.read',
  'collection.write',
  'playlists.read',
  'playlists.write',
].join(' ');

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Generates a cryptographically secure PKCE code verifier (RFC 7636).
// 32 random bytes encoded as base64url → 43-character URL-safe string.
const generateCodeVerifier = (): string =>
  crypto.randomBytes(32).toString('base64url');

// Hashes the verifier with SHA-256 and encodes it as base64url to produce the
// code_challenge sent in the authorization URL.
// The challenge is public; the verifier is kept secret and sent only during token exchange.
const computeCodeChallenge = (verifier: string): string =>
  crypto.createHash('sha256').update(verifier).digest().toString('base64url');

// Constructs a Tidal album artwork URL from the platform's UUID-based image identifier.
// Tidal stores images under resources.tidal.com using the UUID with dashes replaced by slashes.
// Example: "a3e75ea7-9dc3-4e5b-8e16" → "a3/e7/5e/a7/9d/c3/4e/5b/8e/16/..."
const tidalImageUrl = (cover: string | null | undefined, size = 320): string | null => {
  if (!cover) return null;
  return `https://resources.tidal.com/images/${cover.replace(/-/g, '/')}/${size}x${size}.jpg`;
};

// Reads the user's numeric ID and country code from the Tidal access token (a JWT).
// Tidal embeds `uid` (user ID) and `cty` (country code) in the token payload.
// Falls back to safe defaults if the token cannot be decoded (e.g. non-JWT format).
const decodeTidalToken = (accessToken: string): { uid: string; cty: string } => {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')
    );
    return {
      uid: String(payload.uid ?? ''),
      cty: payload.cty ?? 'US',
    };
  } catch {
    return { uid: '', cty: 'US' };
  }
};

// Converts a raw Tidal track object into a normalized PlatformTrack.
// Tidal tracks carry ISRCs natively — present on commercially released tracks.
// Duration is returned in seconds by Tidal; we convert to milliseconds for consistency.
const buildTrack = (
  raw: any,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>
): PlatformTrack => {
  const id = String(raw.id);
  const artistId = String(raw.artist?.id ?? raw.artists?.[0]?.id ?? '');
  const features = audioFeaturesMap[id] || {};
  const genres = artistGenreMap[artistId] || [];

  return {
    id,
    name: raw.title,
    artist: raw.artist?.name ?? raw.artists?.[0]?.name ?? '',
    albumName: raw.album?.title ?? '',
    albumImageUrl: tidalImageUrl(raw.album?.cover),
    durationMs: (raw.duration ?? 0) * 1000,
    releaseYear: raw.album?.releaseDate
      ? parseInt(raw.album.releaseDate.substring(0, 4))
      : null,
    genres,
    audioFeatures: {
      energy:           features.energy           ?? null,
      danceability:     features.danceability     ?? null,
      valence:          features.valence          ?? null,
      acousticness:     features.acousticness     ?? null,
      instrumentalness: features.instrumentalness ?? null,
      speechiness:      features.speechiness      ?? null,
      tempo:            features.tempo            ?? null,
    },
  };
};

// ─── TidalAdapter ─────────────────────────────────────────────────────────────

// Implements PlatformAdapter for Tidal.
// Tidal uses OAuth 2.0 Authorization Code + PKCE — a more secure flow where the client
// generates a code_verifier, hashes it to a code_challenge embedded in the auth URL,
// and sends the raw verifier during token exchange. No client_secret travels over the redirect.
//
// Key differences from Spotify/SoundCloud:
//   - PKCE (code_verifier + code_challenge) required for the auth URL and token exchange
//   - Track IDs are integers (stored as strings at the adapter boundary)
//   - Duration is returned in seconds, not milliseconds
//   - Tidal provides ISRC natively — high cache-hit rate once tracks are enriched once
//   - Playlist writes require an If-None-Match etag header for optimistic concurrency
//   - No single "replace all tracks" endpoint — we clear then re-add in chunks
export class TidalAdapter implements PlatformAdapter {
  readonly platform = 'TIDAL' as const;

  // Stores state → { verifier, expiresAt } while a PKCE auth flow is in flight.
  // The state parameter links the auth URL (where the challenge was embedded) to the
  // callback (where the verifier is needed for token exchange).
  // Entries are swept every 10 minutes to prevent unbounded memory growth.
  private pendingVerifiers = new Map<string, { verifier: string; expiresAt: number }>();

  constructor() {
    // Clean up abandoned PKCE entries every 10 minutes.
    // This handles the case where a user starts the auth flow but never completes it.
    setInterval(() => {
      const now = Date.now();
      for (const [state, entry] of this.pendingVerifiers) {
        if (entry.expiresAt < now) this.pendingVerifiers.delete(state);
      }
    }, 10 * 60 * 1000);
  }

  // Generates the Tidal OAuth authorization URL and stashes the PKCE code verifier.
  // The verifier is stored keyed by the random `state` parameter so the callback can
  // retrieve it. The challenge (a hash of the verifier) travels in the URL to Tidal.
  getAuthUrl(): string {
    const verifier  = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);
    const state     = crypto.randomBytes(16).toString('hex');

    this.pendingVerifiers.set(state, {
      verifier,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes — enough for any real auth flow
    });

    const params = new URLSearchParams({
      client_id:             process.env.TIDAL_CLIENT_ID!,
      redirect_uri:          process.env.TIDAL_REDIRECT_URI!,
      response_type:         'code',
      scope:                 TIDAL_SCOPES,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      state,
    });

    return `${TIDAL_AUTH_URL}?${params}`;
  }

  // Retrieves and removes the PKCE code verifier stored for the given state parameter.
  // Called by the /auth/tidal/callback route immediately before token exchange.
  // Returns null if the state is unknown or the entry has expired — the route should
  // treat this as an invalid request and return 400.
  consumeVerifier(state: string): string | null {
    const entry = this.pendingVerifiers.get(state);
    if (!entry) return null;
    this.pendingVerifiers.delete(state); // consume once — prevents replay
    if (entry.expiresAt < Date.now()) return null;
    return entry.verifier;
  }

  // Exchanges the authorization code and PKCE verifier for access + refresh tokens.
  // Also fetches the user's Tidal profile via /sessions and /users/{id} to populate AuthResult.
  // The `verifier` parameter is optional only to satisfy TypeScript's interface compatibility
  // (the interface defines exchangeCode(code: string)); callers that know this is a TidalAdapter
  // always pass it. An absent verifier will cause the token exchange to fail at Tidal's end.
  async exchangeCode(code: string, verifier?: string): Promise<AuthResult> {
    const tokenResponse = await requestWithRetry(
      'post',
      TIDAL_TOKEN_URL,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     process.env.TIDAL_CLIENT_ID!,
        client_secret: process.env.TIDAL_CLIENT_SECRET!,
        redirect_uri:  process.env.TIDAL_REDIRECT_URI!,
        code_verifier: verifier ?? '',
        scope:         TIDAL_SCOPES,
      }),
      3,
      'Tidal auth'
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // /sessions returns the authenticated user's numeric ID and their country code.
    // The country code is required by most Tidal API endpoints as a query parameter.
    const sessionResponse = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/sessions`,
      { headers: { Authorization: `Bearer ${access_token}` } },
      undefined,
      3,
      'Tidal'
    );

    const { userId, countryCode } = sessionResponse.data;

    // Fetch the user's display name and email from their profile.
    const userResponse = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/users/${userId}`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { countryCode },
      },
      undefined,
      3,
      'Tidal'
    );

    const { email, firstName, lastName, username } = userResponse.data;
    const displayName =
      [firstName, lastName].filter(Boolean).join(' ') || username || String(userId);

    return {
      accessToken:    access_token,
      refreshToken:   refresh_token,
      expiresAt:      new Date(Date.now() + expires_in * 1000),
      platformUserId: String(userId),
      displayName,
      email:          email ?? null,
    };
  }

  // Uses the stored refresh token to obtain a new Tidal access token.
  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const response = await requestWithRetry(
      'post',
      TIDAL_TOKEN_URL,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.TIDAL_CLIENT_ID!,
        client_secret: process.env.TIDAL_CLIENT_SECRET!,
        scope:         TIDAL_SCOPES,
      }),
      3,
      'Tidal auth'
    );

    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expiresAt:   new Date(Date.now() + expires_in * 1000),
    };
  }

  // Fetches all playlists owned or favorited by the authenticated user.
  // Uses the playlistsAndFavoritePlaylists endpoint so both owned and followed
  // playlists appear in the dashboard, matching Spotify's behavior.
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const { uid, cty } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/users/${uid}/playlistsAndFavoritePlaylists`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 50, offset: 0, countryCode: cty },
      },
      undefined,
      3,
      'Tidal'
    );

    return (response.data.items || []).map((item: any) => {
      // The endpoint wraps favorited playlists in a { playlist: {...} } envelope.
      // Owned playlists are returned unwrapped. Normalize both shapes here.
      const p = item.playlist ?? item;
      return {
        id:         p.uuid,
        name:       p.title,
        trackCount: p.numberOfTracks ?? 0,
        imageUrl:   tidalImageUrl(p.squareImage),
        ownerId:    String(p.creator?.id ?? ''),
      };
    });
  }

  // Fetches metadata for a single Tidal playlist by its UUID.
  // Used when a user discovers a playlist they don't own via URL paste.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    const { cty } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/playlists/${playlistId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { countryCode: cty },
      },
      undefined,
      3,
      'Tidal'
    );

    const p = response.data;
    return {
      id:         p.uuid,
      name:       p.title,
      ownerId:    String(p.creator?.id ?? ''),
      trackCount: p.numberOfTracks ?? 0,
      imageUrl:   tidalImageUrl(p.squareImage),
    };
  }

  // Fetches one page of enriched tracks from a Tidal playlist.
  // page=0 returns tracks 0–49, page=1 returns 50–99, etc.
  // Tidal provides ISRCs natively — most commercially released tracks will get a
  // cache hit on second load since the ISRC cross-platform lookup runs once per recording.
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit  = 50;
    const offset = page * limit;
    const { cty } = decodeTidalToken(accessToken);

    const tracksResponse = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/playlists/${playlistId}/tracks`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset, countryCode: cty },
      },
      undefined,
      3,
      'Tidal'
    );

    const rawTracks: any[] = tracksResponse.data.items || [];
    const total: number    = tracksResponse.data.totalNumberOfItems ?? 0;

    // Tidal tracks carry ISRCs natively — use them for cross-platform cache lookup.
    // platformId = Tidal numeric ID (as string).
    // spotifyId  = null initially; backgroundEnrichTracks resolves via ISRC if needed.
    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: String(t.id),
      spotifyId:  null,
      artistId:   String(t.artist?.id ?? t.artists?.[0]?.id ?? ''),
      artistName: t.artist?.name ?? t.artists?.[0]?.name ?? '',
      isrc:       t.isrc ?? undefined,
      platform:   'TIDAL' as const,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0 || uniqueMissedArtists.length > 0) {
      console.log(`[Tidal] Enriching ${missedTracks.length} uncached track(s) in background`);
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[Tidal] Background enrichment error:', err)
      );
    }

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total };
  }

  // Returns the number of tracks in the user's Tidal favorites (their "My Collection").
  async fetchLikedCount(accessToken: string): Promise<number> {
    const { uid, cty } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/users/${uid}/favorites/tracks`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 1, offset: 0, countryCode: cty },
      },
      undefined,
      3,
      'Tidal'
    );

    return response.data.totalNumberOfItems ?? 0;
  }

  // Fetches one page of enriched tracks from the user's Tidal favorites.
  // The favorites endpoint wraps each track in an { item: Track } envelope.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit  = 50;
    const offset = page * limit;
    const { uid, cty } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'get',
      `${TIDAL_API_V1}/users/${uid}/favorites/tracks`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset, countryCode: cty },
      },
      undefined,
      3,
      'Tidal'
    );

    const total: number    = response.data.totalNumberOfItems ?? 0;
    // The favorites/tracks endpoint wraps each entry: { item: Track, created: ... }
    const rawTracks: any[] = (response.data.items || []).map((i: any) => i.item ?? i);

    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: String(t.id),
      spotifyId:  null,
      artistId:   String(t.artist?.id ?? t.artists?.[0]?.id ?? ''),
      artistName: t.artist?.name ?? t.artists?.[0]?.name ?? '',
      isrc:       t.isrc ?? undefined,
      platform:   'TIDAL' as const,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0 || uniqueMissedArtists.length > 0) {
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[Tidal] Background enrichment error:', err)
      );
    }

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total };
  }

  // Fetches all tracks in a playlist with minimal data — no audio-feature enrichment.
  // Used by the auto-reshuffle cron to avoid hitting ReccoBeats for every track.
  async fetchAllTracksMeta(
    accessToken: string,
    playlistId: string
  ): Promise<PlatformTrackMeta[]> {
    const { cty } = decodeTidalToken(accessToken);
    const limit   = 50;
    let offset    = 0;
    const tracks: PlatformTrackMeta[] = [];

    while (true) {
      const response = await requestWithRetry(
        'get',
        `${TIDAL_API_V1}/playlists/${playlistId}/tracks`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit, offset, countryCode: cty },
        },
        undefined,
        3,
        'Tidal'
      );

      const rawTracks: any[] = response.data.items || [];
      const total: number    = response.data.totalNumberOfItems ?? 0;

      tracks.push(
        ...rawTracks.map((t: any) => ({
          id:          String(t.id),
          artist:      t.artist?.name ?? t.artists?.[0]?.name ?? '',
          genres:      [] as string[],
          releaseYear: t.album?.releaseDate
            ? parseInt(t.album.releaseDate.substring(0, 4))
            : null,
        }))
      );

      if (offset + limit >= total) break;
      offset += limit;
    }

    return tracks;
  }

  // Creates a new playlist in the user's Tidal account.
  // Uses the v2 my-collection endpoint which supports Tidal's folder-based organization.
  async createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }> {
    const { uid } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'put',
      `${TIDAL_API_V2}/my-collection/playlists/folders/create-playlist`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { name, description, folderId: 'root' },
      },
      undefined,
      3,
      'Tidal'
    );

    // The v2 endpoint returns { data: { uuid, ... } }
    const data = response.data?.data ?? response.data;
    return {
      id:      data.uuid,
      ownerId: uid,
    };
  }

  // Replaces the entire track list of a Tidal playlist with a new ordered list.
  //
  // Tidal has no single "replace all" endpoint. The strategy is:
  //   Phase 1 — DELETE existing tracks in chunks of 50 from the front (index 0 always).
  //             After each chunk, re-fetch the playlist to get the updated etag and count.
  //   Phase 2 — POST new tracks in chunks of 50, tracking the insertion position manually.
  //             Each POST also re-fetches etag first (required for optimistic concurrency).
  //
  // The etag (If-None-Match header) is Tidal's optimistic concurrency mechanism:
  // it ensures we're not overwriting a playlist that changed between our reads and writes.
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    // Fetches the current playlist state (track count + etag) in one call.
    const fetchMeta = async (): Promise<{ numTracks: number; etag: string }> => {
      const r = await requestWithRetry(
        'get',
        `${TIDAL_API_V1}/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        undefined,
        3,
        'Tidal'
      );
      return {
        numTracks: r.data.numberOfTracks ?? 0,
        etag:      r.headers['etag'] ?? '',
      };
    };

    // Phase 1: clear all existing tracks.
    // Always delete indices starting from 0 — after each deletion the remaining
    // items shift down, so we can always target 0..N to remove the first N items.
    let { numTracks, etag } = await fetchMeta();
    while (numTracks > 0) {
      const count   = Math.min(numTracks, 50);
      const indices = Array.from({ length: count }, (_, i) => i).join(',');

      await requestWithRetry(
        'delete',
        `${TIDAL_API_V1}/playlists/${playlistId}/items/${indices}`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'If-None-Match': etag } },
        undefined,
        3,
        'Tidal'
      );

      ({ numTracks, etag } = await fetchMeta());
    }

    // Phase 2: add the new tracks in chunks of 50.
    let insertPosition = 0;
    for (let i = 0; i < trackIds.length; i += 50) {
      const chunk = trackIds.slice(i, i + 50);
      const { etag: currentEtag } = await fetchMeta();

      await requestWithRetry(
        'post',
        `${TIDAL_API_V1}/playlists/${playlistId}/items`,
        {
          headers: {
            Authorization:  `Bearer ${accessToken}`,
            'If-None-Match': currentEtag,
            'Content-Type':  'application/x-www-form-urlencoded',
          },
        },
        new URLSearchParams({
          trackIds:           chunk.join(','),
          onDupes:            'ADD',
          toIndex:            String(insertPosition),
          onArtifactNotFound: 'SKIP',
        }),
        3,
        'Tidal'
      );

      insertPosition += chunk.length;
    }
  }

  // Appends tracks to an existing Tidal playlist without replacing existing content.
  // Each chunk requires a fresh etag — Tidal rejects writes with a stale etag.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    for (let i = 0; i < trackIds.length; i += 50) {
      const chunk = trackIds.slice(i, i + 50);

      // Fetch current state to get etag and current track count (toIndex = append at end).
      const r = await requestWithRetry(
        'get',
        `${TIDAL_API_V1}/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        undefined,
        3,
        'Tidal'
      );
      const etag      = r.headers['etag'] ?? '';
      const numTracks = r.data.numberOfTracks ?? 0;

      await requestWithRetry(
        'post',
        `${TIDAL_API_V1}/playlists/${playlistId}/items`,
        {
          headers: {
            Authorization:  `Bearer ${accessToken}`,
            'If-None-Match': etag,
            'Content-Type':  'application/x-www-form-urlencoded',
          },
        },
        new URLSearchParams({
          trackIds:           chunk.join(','),
          onDupes:            'ADD',
          toIndex:            String(numTracks),
          onArtifactNotFound: 'SKIP',
        }),
        3,
        'Tidal'
      );
    }
  }

  // Tidal uses plain integer IDs for tracks — no URI format required.
  // This is a no-op passthrough to satisfy the PlatformAdapter interface.
  formatTrackUri(trackId: string): string {
    return trackId;
  }

  // Checks whether a playlist is still present and accessible to the user.
  // Returns true on any non-404 error — the cleanup cron must not delete a schedule
  // when the answer is ambiguous (network failure, 5xx, etc.).
  async playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean> {
    try {
      await requestWithRetry(
        'get',
        `${TIDAL_API_V1}/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        undefined,
        3,
        'Tidal'
      );
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) return false;
      return true; // network/5xx — assume it still exists
    }
  }
}
