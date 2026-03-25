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
// TIDAL_OPENAPI is the new REST API that uses the PKCE scopes (user.read, collection.read, etc.)
// The legacy v1 API (api.tidal.com/v1) requires the old r_usr/r_collection scopes and is not
// available to PKCE-based third-party apps registered after the new developer portal.
const TIDAL_OPENAPI          = 'https://openapi.tidal.com/v2';
const TIDAL_API_V2           = 'https://api.tidal.com/v2'; // kept for playlist-creation endpoint
const TIDAL_TRACKS_PER_PAGE  = 20; // max tracks per POST /relationships/items request

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

// Reads the user's numeric ID and country code from the Tidal access token (a JWT).
// Tidal embeds `uid` (user ID) and `cc` (country code) in the token payload.
// Falls back to safe defaults if the token cannot be decoded (e.g. non-JWT format).
const decodeTidalToken = (accessToken: string): { uid: string; cc: string } => {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')
    );
    return {
      uid: String(payload.uid ?? ''),
      cc:  payload.cc ?? 'US',
    };
  } catch {
    return { uid: '', cc: 'US' };
  }
};

// JSON:API helper — builds a Map<id, item> for a given resource type from the `included` array.
// Tidal's v2 API follows JSON:API spec: related resources (artists, albums) are embedded in
// `included` and referenced from `relationships` on the primary data.
const buildIncludedMap = (included: any[] = [], type: string): Map<string, any> => {
  const map = new Map<string, any>();
  for (const item of included) {
    if (item.type === type) map.set(String(item.id), item);
  }
  return map;
};

// Parses a Tidal v2 duration value to milliseconds.
// Tidal returns duration as an ISO 8601 duration string (e.g. "PT3M45S"), not a number.
// Handles the PT[H]H[M]M[S]S format; falls back to 0 for unparseable values.
const parseDurationMs = (duration: unknown): number => {
  if (typeof duration === 'number') return Math.round(duration * 1000);
  if (typeof duration !== 'string') return 0;
  const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return 0;
  const h = parseFloat(m[1] ?? '0');
  const min = parseFloat(m[2] ?? '0');
  const sec = parseFloat(m[3] ?? '0');
  return Math.round((h * 3600 + min * 60 + sec) * 1000);
};

// Converts a Tidal v2 JSON:API track node into a normalized PlatformTrack.
// v2 stores attributes under `item.attributes`, with artists/album/genres in `included`.
// genresMap is built from `include=items.genres` and takes priority over Last.fm artistGenreMap
// because Tidal's own genre tags are already per-track (not per-artist) and require no extra API call.
const buildTrackV2 = (
  item: any,
  artistsMap: Map<string, any>,
  albumsMap: Map<string, any>,
  artworksMap: Map<string, any>,
  genresMap: Map<string, any>,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>
): PlatformTrack => {
  const id = String(item.id);
  const attrs = item.attributes ?? {};

  const artistRef  = item.relationships?.artists?.data?.[0];
  const albumRef   = item.relationships?.albums?.data?.[0]; // Tidal uses 'albums' (plural array)
  const artistId   = String(artistRef?.id ?? '');
  const artistData = artistRef ? artistsMap.get(String(artistRef.id)) : null;
  const albumData  = albumRef  ? albumsMap.get(String(albumRef.id))   : null;

  // Album cover art lives in relationships.coverArt → artworks included resource.
  // Same shape as playlist cover art: attributes.files[].{ href, meta: { width, height } }.
  let albumImageUrl: string | null = null;
  const coverArtRefs: any[] = albumData?.relationships?.coverArt?.data ?? [];
  for (const artRef of coverArtRefs) {
    const artwork = artworksMap.get(String(artRef.id));
    if (!artwork) continue;
    const files: any[] = artwork.attributes?.files ?? [];
    if (files.length > 0) {
      const preferred = files.find((f: any) => f.meta?.width >= 320) ?? files[files.length - 1];
      albumImageUrl = preferred?.href ?? null;
      break;
    }
  }

  // Tidal's v2 API returns relationships.genres.data: [] for all tracks — confirmed via raw API
  // inspection. We fall back to Last.fm artist-level genre tags (same approach as SoundCloud).
  const genres: string[] = artistGenreMap[artistId] ?? [];

  // In Tidal v2, release date is on the album resource, not the track.
  // albumData.attributes.releaseDate is an ISO date string (e.g. "2023-05-12").
  const albumAttrs  = albumData?.attributes ?? {};
  const releaseYear = albumAttrs.releaseDate
    ? parseInt(String(albumAttrs.releaseDate).slice(0, 4), 10) || null
    : null;

  const features = audioFeaturesMap[id] || {};

  return {
    id,
    name:         attrs.title ?? '',
    artist:       artistData?.attributes?.name ?? '',
    albumName:    albumData?.attributes?.title ?? '',
    albumImageUrl,
    durationMs:   parseDurationMs(attrs.duration),
    releaseYear,
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
  readonly trackCacheIdField  = 'tidalId';
  readonly artistCacheIdField = 'tidalArtistId';

  // Stores state → { verifier, expiresAt } while a PKCE auth flow is in flight.
  // The state parameter links the auth URL (where the challenge was embedded) to the
  // callback (where the verifier is needed for token exchange).
  // Entries are swept every 10 minutes to prevent unbounded memory growth.
  private pendingVerifiers = new Map<string, { verifier: string; expiresAt: number }>();

  // Bridges Tidal's cursor-based pagination to the client's page-number model.
  // Tidal does not support page[offset] — it only supports cursor tokens.
  // When page N is fetched, the nextCursor from that response is stored here
  // under the key `uid:playlistId:(N+1)` so the next request can resume from
  // exactly where the previous one left off, streaming 50 tracks at a time.
  // Entries expire after 10 minutes — enough for any realistic playlist load session.
  // `accumulated` tracks the true count of refs returned so far across all previous pages.
  // Tidal caps pages at 20 refs regardless of page[size], so we can't use page*limit — we
  // need the real running total to display an accurate "X out of Y" counter in the UI.
  private playlistCursorCache = new Map<string, { cursor: string; accumulated: number; expiresAt: number }>();

  // Full liked-tracks result cache, keyed by uid.
  // fetchLikedTracks fetches every page server-side before returning, which takes a few
  // seconds for large libraries. Caching the result means navigating away and back to
  // Liked Songs is instant for the next 5 minutes instead of triggering another full fetch.
  private likedTracksCache = new Map<string, { tracks: PlatformTrack[]; total: number; expiresAt: number }>();

  // Builds the cache key that maps a page request to its Tidal cursor.
  private cursorKey = (uid: string, playlistId: string, page: number) =>
    `${uid}:${playlistId}:${page}`;

  constructor() {
    // Sweep both caches every 10 minutes to prevent unbounded memory growth.
    setInterval(() => {
      const now = Date.now();
      for (const [state, entry] of this.pendingVerifiers) {
        if (entry.expiresAt < now) this.pendingVerifiers.delete(state);
      }
      for (const [key, entry] of this.playlistCursorCache) {
        if (entry.expiresAt < now) this.playlistCursorCache.delete(key);
      }
      for (const [uid, entry] of this.likedTracksCache) {
        if (entry.expiresAt < now) this.likedTracksCache.delete(uid);
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
      redirect_uri:          `${process.env.SERVER_URL}/auth/tidal/callback`,
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
        redirect_uri:  `${process.env.SERVER_URL}/auth/tidal/callback`,
        code_verifier: verifier ?? '',
        scope:         TIDAL_SCOPES,
      }),
      3,
      'Tidal auth'
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Decode the JWT access token to extract the user ID and country code.
    // Tidal embeds `uid` and `cc` directly in the token payload, so we don't need
    // a separate /sessions call — which is unavailable on PKCE-based developer apps.
    const { uid: userId, cc: countryCode } = decodeTidalToken(access_token);

    // Fetch the user's display name and email from their profile.
    // Falls back gracefully if the endpoint errors — auth still succeeds.
    let email: string | null = null;
    let displayName = userId;
    try {
      // openapi.tidal.com/v2 uses /users/me for the authenticated user's profile.
      // /users/{id} returns 404 for PKCE apps — the "me" endpoint is the correct pattern.
      const userResponse = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/users/me`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
          params: { countryCode },
        },
        undefined,
        3,
        'Tidal'
      );
      // v2 JSON:API shape: { data: { attributes: { ... } } }; fall back to flat shape.
      const u = userResponse.data?.data?.attributes ?? userResponse.data;
      email = u.email ?? null;
      // Tidal PKCE apps receive no firstName/lastName — only username (which equals the email).
      // Extract the local part (before @) so the sidebar shows "yarinso39" not a full email address.
      const rawName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '';
      displayName = rawName.includes('@') ? rawName.split('@')[0] : rawName || userId;
    } catch (profileErr: any) {
      // 404 means the endpoint isn't available for this PKCE app — expected, not an error.
      if (profileErr?.response?.status !== 404) {
        console.warn('[Tidal] Could not fetch user profile — using userId as display name', profileErr);
      }
    }

    return {
      accessToken:    access_token,
      refreshToken:   refresh_token,
      expiresAt:      new Date(Date.now() + expires_in * 1000),
      platformUserId: String(userId),
      displayName:    String(displayName),
      email,
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

  // Fetches the user's own playlists via the v2 OpenAPI (requires playlists.read scope).
  //
  // The correct endpoint is /userCollectionPlaylists/me/relationships/items.
  // "me" is a shorthand for the authenticated user's ID — the server resolves it from the token.
  // The /relationships/items sub-path returns the actual playlist references; include=items
  // asks the server to embed the full playlist objects in the `included` array so we don't
  // need a separate request per playlist.
  //
  // v2 returns JSON:API format: { data: [{ type, id },...], included: [...], meta: { total }, links: { next } }.
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const { uid, cc } = decodeTidalToken(accessToken);
    const playlists: PlatformPlaylist[] = [];
    let cursor: string | null = null;

    // Page through all results using cursor-based pagination.
    do {
      const params: Record<string, any> = { countryCode: cc, 'page[size]': 50, include: 'items,items.coverArt,items.owners' };
      if (cursor) params['page[cursor]'] = cursor;

      const response = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/userCollectionPlaylists/me/relationships/items`,
        { headers: { Authorization: `Bearer ${accessToken}` }, params },
        undefined, 3, 'Tidal'
      );

      // data holds relationship refs { type: 'playlists', id }; full objects are in included.
      const refs: any[] = response.data.data ?? [];
      const included: any[] = response.data.included ?? [];
      const playlistsMap = buildIncludedMap(included, 'playlists');

      // coverArt resources (artworks) are embedded in included when include=items.coverArt is used.
      // Each playlist's coverArt relationship points to one or more artwork IDs.
      const artworksMap = buildIncludedMap(included, 'artworks');

      for (const ref of refs) {
        const item  = playlistsMap.get(String(ref.id)) ?? ref;
        const attrs = item.attributes ?? {};

        // Resolve playlist image from the coverArt relationship → artworks included resource.
        // Artwork files live in attributes.files: [{ href, meta: { width, height } }].
        let imageUrl: string | null = null;
        const coverArtRefs: any[] = item.relationships?.coverArt?.data ?? [];
        for (const artRef of coverArtRefs) {
          const artwork = artworksMap.get(String(artRef.id));
          if (!artwork) continue;
          const files: any[] = artwork.attributes?.files ?? [];
          if (files.length > 0) {
            const preferred = files.find((f: any) => f.meta?.width >= 320) ?? files[files.length - 1];
            imageUrl = preferred?.href ?? null;
            break;
          }
        }

        // Read the actual owner ID from the playlist's owners relationship.
        // The relationship data is an array of user refs: [{ type: 'users', id: '<userId>' }].
        // Falls back to uid (the logged-in user) if the relationship is absent, so owned
        // playlists still work even if the API omits the owners include for some entries.
        // Tidal populates owners.data only for playlists the authenticated user owns.
        // For followed or editorial playlists, owners.data is an empty array — the API
        // does not expose the external owner's identity.
        // An empty data array → set ownerId to '' so the Dashboard correctly places
        // the playlist in the "Following" section (ownerId !== platformUserId).
        const ownerData: any[] = item.relationships?.owners?.data ?? [];
        const ownerId = ownerData.length > 0 ? String(ownerData[0].id) : '';

        playlists.push({
          id:         String(ref.id),
          name:       attrs.name ?? attrs.title ?? '',
          trackCount: attrs.numberOfItems ?? attrs.numberOfTracks ?? 0,
          imageUrl,
          ownerId,
        });
      }

      cursor = response.data.links?.meta?.nextCursor ?? null;

    } while (cursor);

    return playlists;
  }

  // Fetches metadata for a single Tidal playlist by its UUID via v2 OpenAPI.
  // Used when a user discovers a playlist they don't own via URL paste.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    const { uid, cc } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'get',
      `${TIDAL_OPENAPI}/playlists/${playlistId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        // include=owners brings the playlist's owner user ref into the `included` array.
        // Without it, ownerId would always fall back to uid (the logged-in user), which
        // is wrong for playlists discovered via URL that belong to other users.
        params: { countryCode: cc, include: 'owners' },
      },
      undefined, 3, 'Tidal'
    );

    // v2 returns JSON:API: { data: { id, attributes, relationships }, included: [...] }
    const d        = response.data.data ?? response.data;
    const attrs    = d.attributes ?? d;
    const included: any[] = response.data.included ?? [];

    // Resolve the real owner from the owners relationship → included users array.
    // Falls back to uid (logged-in user) when the include is absent or ownership is unclear.
    const ownerRef = d.relationships?.owners?.data?.[0];
    const ownerId  = ownerRef?.id ? String(ownerRef.id) : uid;

    return {
      id:         String(d.id ?? playlistId),
      name:       attrs.name ?? attrs.title ?? '',
      ownerId,
      trackCount: attrs.numberOfItems ?? attrs.numberOfTracks ?? 0,
      imageUrl:   null, // single playlist fetch has no image; coverArt needs a separate include
    };
  }

  // Fetches one page of enriched tracks from a Tidal playlist via v2 OpenAPI.
  //
  // IMPORTANT: Tidal does not support page[offset] — that parameter is silently ignored
  // and the API always returns the first page. We work around this by caching the
  // nextCursor from each response in `playlistCursorCache`, keyed to the next page number.
  // Each page request looks up its cursor, fetches exactly one page, then stores the
  // cursor for the next page — giving the client the same streaming experience as Spotify.
  //
  // If the cursor for a page is not in cache (e.g. the server restarted mid-load),
  // the response returns empty so the client's hasMore check resolves to false.
  // signal is forwarded into requestWithRetry so the Tidal API call is cancelled
  // immediately when the client drops the HTTP connection.
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number,
    signal?: AbortSignal
  ): Promise<{ tracks: PlatformTrack[]; total: number; hasMore: boolean }> {
    const limit = 50;
    const { uid, cc } = decodeTidalToken(accessToken);

    // Determine the cursor to use for this page.
    // Page 0 starts from the beginning (no cursor). Page N>0 requires the cursor
    // that was stored when page N-1 was fetched. If that cursor is missing or expired,
    // return empty — the client loop will stop because hasMore will be false.
    let cursor: string | null = null;
    let accumulated = 0; // true count of tracks loaded across all previous pages
    if (page > 0) {
      const entry = this.playlistCursorCache.get(this.cursorKey(uid, playlistId, page));
      if (!entry || entry.expiresAt < Date.now()) return { tracks: [], total: 0, hasMore: false };
      cursor      = entry.cursor;
      accumulated = entry.accumulated;
      // Consume the entry — each cursor is valid for one fetch only.
      this.playlistCursorCache.delete(this.cursorKey(uid, playlistId, page));
    }

    const params: Record<string, any> = {
      countryCode: cc,
      'page[size]': limit,
      include: 'items,items.artists,items.albums,items.albums.coverArt,items.genres',
    };
    if (cursor) params['page[cursor]'] = cursor;

    const response = await requestWithRetry(
      'get',
      `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params },
      undefined, 3, 'Tidal', signal
    );

    const body     = response.data;
    const included: any[] = body.included ?? [];

    const nextCursor: string | null = body.links?.meta?.nextCursor ?? null;

    // Build rawTracks BEFORE computing the accumulated count so that newAccumulated
    // reflects only audio tracks. Tidal playlists can contain non-audio items (videos,
    // podcasts) which appear in body.data but have type !== 'tracks'. Using body.data.length
    // would over-count them, making `total` higher than the number of tracks the client
    // actually receives — which the user perceives as data loss during splits.
    const tracksMap = buildIncludedMap(included, 'tracks');
    const rawTracks: any[] = (body.data ?? [])
      .filter((ref: any) => ref.type === 'tracks')
      .map((ref: any) => tracksMap.get(String(ref.id)))
      .filter(Boolean);

    // Accumulate only actual audio tracks across pages (not all playlist items).
    const newAccumulated = accumulated + rawTracks.length;

    // Store the cursor for the next page, along with the running accumulated count,
    // so the next request knows how many tracks have truly been loaded so far.
    if (nextCursor) {
      this.playlistCursorCache.set(this.cursorKey(uid, playlistId, page + 1), {
        cursor:      nextCursor,
        accumulated: newAccumulated,
        expiresAt:   Date.now() + 10 * 60 * 1000,
      });
    }

    // total = running audio-track count only. We intentionally do not use body.meta?.total
    // because Tidal's total counts ALL playlist items (tracks + videos + other), which
    // can be higher than the number of audio tracks we return.
    const total: number = newAccumulated;

    const artistsMap  = buildIncludedMap(included, 'artists');
    const albumsMap   = buildIncludedMap(included, 'albums');
    const artworksMap = buildIncludedMap(included, 'artworks');
    const genresMap   = buildIncludedMap(included, 'genres');

    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => {
      const artistRef  = t.relationships?.artists?.data?.[0];
      const artistId   = String(artistRef?.id ?? '');
      const artistData = artistRef ? artistsMap.get(String(artistRef.id)) : null;
      return {
        platformId: String(t.id),
        spotifyId:  null,
        idField:    this.trackCacheIdField,
        artistId,
        artistName: artistData?.attributes?.name ?? '',
        isrc:       t.attributes?.isrc ?? undefined,
        platform:   'TIDAL' as const,
      };
    });

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0 || uniqueMissedArtists.length > 0) {
      // Tidal's native genre API returns empty for most tracks, so we fall back to Last.fm
      // for genre lookup — the same approach SoundCloud uses.
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[Tidal] Background enrichment error:', err)
      );
    }
    const tracks = rawTracks.map(t =>
      buildTrackV2(t, artistsMap, albumsMap, artworksMap, genresMap, audioFeaturesMap, artistGenreMap)
    );
    // Return hasMore directly so the route doesn't have to guess via page*limit,
    // which breaks because Tidal caps pages at 20 refs regardless of page[size]=50.
    return { tracks, total, hasMore: !!nextCursor };
  }

  // Returns the number of tracks in the user's Tidal favorites via v2 OpenAPI.
  // Tidal does not expose a total count on this endpoint — there is no meta.total.
  // We page through all items using cursor pagination and sum the counts.
  // Each page is lightweight (no `include` → only IDs returned) so this is fast.
  async fetchLikedCount(accessToken: string): Promise<number> {
    const { cc } = decodeTidalToken(accessToken);
    let total = 0;
    let cursor: string | null = null;

    do {
      const params: Record<string, any> = { countryCode: cc, 'page[size]': 50 };
      if (cursor) params['page[cursor]'] = cursor;

      const response = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/userCollectionTracks/me/relationships/items`,
        { headers: { Authorization: `Bearer ${accessToken}` }, params },
        undefined, 3, 'Tidal'
      );

      total += (response.data.data ?? []).length;
      cursor = response.data.links?.meta?.nextCursor ?? null;
      // Small pause between pages to stay within Tidal's rate limit
      if (cursor) await new Promise(resolve => setTimeout(resolve, 200));
    } while (cursor);

    return total;
  }

  // Fetches one page of enriched tracks from the user's Tidal favorites via v2 OpenAPI.
  //
  // NOTE: Pagination for this endpoint is fundamentally broken — see TODOS.md for full context.
  // Current approach: cursor-based pagination (the only approach that terminates).
  // page[offset] is silently ignored on this endpoint.
  // Known limitation: ~83 tracks may be missing for bulk-imported collections due to
  // non-deterministic cursor ordering when many tracks share the same addedAt timestamp.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number; hasMore: boolean }> {
    const { uid, cc } = decodeTidalToken(accessToken);

    // Return the cached result if it is still fresh. The full fetch takes a few seconds
    // for large libraries; a 5-minute cache makes subsequent navigations to Liked Songs
    // feel instant without showing stale data for more than a brief window.
    const cached = this.likedTracksCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      return { tracks: cached.tracks, total: cached.total, hasMore: false };
    }

    // The page parameter satisfies the PlatformAdapter interface but is unused here.
    // We fetch all pages server-side using sort=title (alphabetical). Tidal's default
    // addedAt-based cursors are non-deterministic when many tracks share the same
    // addedAt timestamp (e.g. bulk imports), consistently skipping the same tracks.
    // Alphabetical cursors are independent of import time and return the full collection.
    const allRefs:     any[] = [];  // JSON:API relationship refs across all pages
    const allIncluded: any[] = [];  // full resource objects embedded by the API
    let total      = 0;
    let cursor: string | null = null;
    let pageCount  = 0;
    let totalRefs  = 0;

    do {
      const params: Record<string, any> = {
        countryCode: cc,
        sort: 'title',
        include: 'items,items.artists,items.albums,items.albums.coverArt,items.genres',
      };
      if (cursor) params['page[cursor]'] = cursor;

      const response = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/userCollectionTracks/me/relationships/items`,
        { headers: { Authorization: `Bearer ${accessToken}` }, params },
        undefined, 3, 'Tidal'
      );

      const body = response.data;
      pageCount++;
      totalRefs += (body.data ?? []).length;

      // meta.total is only present on the first page.
      if (pageCount === 1) total = body.meta?.total ?? 0;

      allRefs.push(...(body.data ?? []));
      allIncluded.push(...(body.included ?? []));

      cursor = body.links?.meta?.nextCursor ?? null;

      // Wait between pages to stay within Tidal's rate limit window.
      if (cursor) await new Promise(resolve => setTimeout(resolve, 300));

    } while (cursor);

    console.log(`[Tidal LikedTracks] ${totalRefs} refs fetched across ${pageCount} pages`);

    // Deduplicate by track ID — the same track can appear on two consecutive pages
    // when many tracks share a cursor boundary value.
    const seenIds = new Set<string>();
    const uniqueRefs = allRefs.filter(ref => {
      if (ref.type !== 'tracks') return false;
      const key = String(ref.id);
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    // Build lookup maps from the combined included array across all pages.
    // buildIncludedMap groups resources by type — passing the full allIncluded array
    // ensures a track's artist/album/artwork is found even if it was embedded on a
    // different page than the track reference itself.
    const tracksMap   = buildIncludedMap(allIncluded, 'tracks');
    const artistsMap  = buildIncludedMap(allIncluded, 'artists');
    const albumsMap   = buildIncludedMap(allIncluded, 'albums');
    const artworksMap = buildIncludedMap(allIncluded, 'artworks');
    const genresMap   = buildIncludedMap(allIncluded, 'genres');

    const rawTracks: any[] = uniqueRefs
      .map(ref => tracksMap.get(String(ref.id)))
      .filter(Boolean);

    // Fall back to the actual deduplicated count if meta.total was absent.
    if (total === 0) total = rawTracks.length;

    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => {
      const artistRef  = t.relationships?.artists?.data?.[0];
      const artistId   = String(artistRef?.id ?? '');
      const artistData = artistRef ? artistsMap.get(String(artistRef.id)) : null;
      return {
        platformId: String(t.id),
        spotifyId:  null,
        idField:    this.trackCacheIdField,
        artistId,
        artistName: artistData?.attributes?.name ?? '',
        isrc:       t.attributes?.isrc ?? undefined,
        platform:   'TIDAL' as const,
      };
    });

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0) {
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[Tidal] Background enrichment error:', err)
      );
    }

    const tracks = rawTracks.map(t =>
      buildTrackV2(t, artistsMap, albumsMap, artworksMap, genresMap, audioFeaturesMap, artistGenreMap)
    );

    // Cache the full result before returning. Any subsequent request within the next
    // 5 minutes (e.g. the user navigates away and back) hits the cache instead of
    // re-fetching all pages from Tidal.
    this.likedTracksCache.set(uid, { tracks, total, expiresAt: Date.now() + 5 * 60 * 1000 });

    return { tracks, total, hasMore: false };
  }

  // Fetches all tracks in a playlist with minimal data — no audio-feature enrichment.
  // Used by the auto-reshuffle cron to avoid hitting ReccoBeats for every track.
  // Uses v2 OpenAPI with cursor-based pagination.
  async fetchAllTracksMeta(
    accessToken: string,
    playlistId: string
  ): Promise<PlatformTrackMeta[]> {
    const { cc } = decodeTidalToken(accessToken);
    const tracks: PlatformTrackMeta[] = [];
    let cursor: string | null = null;

    do {
      const params: Record<string, any> = { countryCode: cc, 'page[size]': 50, include: 'items' };
      if (cursor) params['page[cursor]'] = cursor;

      const response = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
        { headers: { Authorization: `Bearer ${accessToken}` }, params },
        undefined, 3, 'Tidal'
      );

      const body     = response.data;
      const included = body.included ?? [];
      const tracksMap = buildIncludedMap(included, 'tracks');

      // data holds relationship refs { type: 'tracks', id }; resolve each against included.
      for (const ref of (body.data ?? [])) {
        if (ref.type !== 'tracks') continue;
        const t = tracksMap.get(String(ref.id));
        if (!t) continue;
        tracks.push({
          id:          String(t.id),
          artist:      '',  // artist lookup not needed for cron shuffle
          genres:      [],
          releaseYear: null,
        });
      }

      cursor = body.links?.next
        ? new URL(body.links.next, TIDAL_OPENAPI).searchParams.get('page[cursor]')
        : null;
    } while (cursor);

    return tracks;
  }

  // Creates a new playlist in the user's Tidal account.
  // NOTE: This endpoint still uses TIDAL_API_V2 (api.tidal.com/v2) rather than TIDAL_OPENAPI.
  // If it returns a 403 "missing scope" error, migrate it to openapi.tidal.com/v2 once
  // a suitable v2 OpenAPI playlist-creation endpoint is documented.
  // Creates a new playlist in the user's Tidal account via the OpenAPI v2 endpoint.
  // Uses POST /playlists with a JSON:API body — same base URL as all other write operations.
  // An Idempotency-Key header is included so a retried request on network failure
  // returns the already-created playlist instead of creating a duplicate.
  async createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }> {
    const { uid, cc } = decodeTidalToken(accessToken);

    const response = await requestWithRetry(
      'post',
      `${TIDAL_OPENAPI}/playlists`,
      {
        headers: {
          Authorization:     `Bearer ${accessToken}`,
          'Content-Type':    'application/vnd.api+json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        params: { countryCode: cc },
      },
      // JSON:API resource object — `type` identifies the resource, `attributes` holds the data.
      {
        data: {
          type:       'playlists',
          attributes: { name, description, accessType: 'PUBLIC' },
        },
      },
      3,
      'Tidal'
    );

    // OpenAPI v2 returns { data: { id, type, attributes, ... } }
    // `id` is a UUID string assigned by the server.
    const data = response.data?.data ?? response.data;
    return {
      id:      String(data.id),
      ownerId: uid,
    };
  }

  // Replaces the entire track list of a Tidal playlist with a new ordered list.
  //
  // v2 OpenAPI strategy (DELETE removed slots → PATCH new order):
  //
  //   Phase 1 — Fetch all current items, collecting both trackId and itemId per slot.
  //             itemId is a per-slot identifier Tidal assigns — two duplicate tracks in
  //             the same playlist each have a different itemId. We preserve duplicates
  //             correctly by keeping a queue of itemIds per trackId and consuming them
  //             in order.
  //
  //   Phase 2 — DELETE any slots that are not needed in the new list (e.g. removed
  //             duplicates, manually removed tracks). Uses itemId to identify the exact
  //             slot to remove. Chunked at TIDAL_TRACKS_PER_PAGE.
  //
  //   Phase 3 — PATCH /relationships/items with all tracks in the desired order.
  //             Each track carries its assigned itemId so Tidal can reorder the slot.
  //             New tracks (not currently in the playlist) omit itemId.
  //
  // Separating DELETE from PATCH is necessary because PATCH only reorders existing
  // slots — it cannot remove them.
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const readHeaders  = { Authorization: `Bearer ${accessToken}` };
    const writeHeaders = {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.api+json',
    };

    // Phase 1: collect every current { trackId, itemId } pair in playlist order.
    // Duplicates produce separate entries — e.g. two slots for the same track ID,
    // each with a distinct itemId.
    const currentItems: Array<{ trackId: string; itemId: string }> = [];
    let cursor: string | null = null;
    do {
      const params: Record<string, any> = { 'page[size]': 50 };
      if (cursor) params['page[cursor]'] = cursor;
      const r = await requestWithRetry(
        'get',
        `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
        { headers: readHeaders, params },
        undefined, 3, 'Tidal'
      );
      for (const ref of (r.data.data ?? [])) {
        if (ref.type === 'tracks' && ref.meta?.itemId) {
          currentItems.push({ trackId: String(ref.id), itemId: String(ref.meta.itemId) });
        }
      }
      cursor = r.data.links?.meta?.nextCursor ?? null;
    } while (cursor);

    // Build a queue of available itemIds per trackId (in the order they appear in the
    // playlist). For each entry in the new track list, we pop the first available slot
    // for that track — this ensures duplicate tracks each get a distinct itemId assigned.
    const itemIdQueues = new Map<string, string[]>();
    for (const { trackId, itemId } of currentItems) {
      if (!itemIdQueues.has(trackId)) itemIdQueues.set(trackId, []);
      itemIdQueues.get(trackId)!.push(itemId);
    }

    // Assign itemIds to the new track order by consuming from each track's queue.
    const newItems = trackIds.map(trackId => {
      const itemId = itemIdQueues.get(trackId)?.shift();
      return { trackId, itemId };
    });

    // Any itemId still left in the queues after assignment belongs to a slot that was
    // removed (e.g. the second occurrence of a duplicate). Collect them for deletion.
    const usedItemIds = new Set(newItems.map(i => i.itemId).filter(Boolean));
    const toDelete    = currentItems.filter(({ itemId }) => !usedItemIds.has(itemId));

    // Determine whether the order of remaining tracks actually changed.
    // Compare the current playlist order (minus deleted slots) against the new order.
    // If they match (e.g. pure duplicate removal), PATCH is unnecessary and should be
    // skipped — calling PATCH right after DELETE causes a 400.
    const remainingOrder = currentItems
      .filter(({ itemId }) => usedItemIds.has(itemId))
      .map(({ trackId }) => trackId);
    const needsReorder = remainingOrder.join(',') !== trackIds.join(',');

    // Phase 2: DELETE slots that need to be removed.
    // - Pure duplicate removal (needsReorder=false): only toDelete slots are removed.
    // - Shuffle / drag-reorder (needsReorder=true): ALL current slots are deleted so
    //   Phase 3 can re-add them in the correct order via POST.
    //   PATCH would be the natural fit for reordering, but Tidal enforces the same
    //   20-item limit on PATCH as on POST, and PATCH cannot be chunked (each chunk
    //   would overwrite the previous one). DELETE-all + POST-all sidesteps this.
    const slotsToDelete = needsReorder ? currentItems : toDelete;

    for (let i = 0; i < slotsToDelete.length; i += TIDAL_TRACKS_PER_PAGE) {
      const chunk = slotsToDelete.slice(i, i + TIDAL_TRACKS_PER_PAGE);
      await requestWithRetry(
        'delete',
        `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
        {
          headers: { ...writeHeaders, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            data: chunk.map(({ trackId, itemId }) => ({
              id:   trackId,
              type: 'tracks',
              meta: { itemId },
            })),
          },
        } as any,
        undefined, 3, 'Tidal'
      );
    }

    // Phase 3: POST all tracks in the new order.
    // Only runs when the order actually changed — skipped for pure duplicate removal
    // where the relative order of remaining tracks is already correct after DELETE.
    if (needsReorder) {
      const { cc }  = decodeTidalToken(accessToken);
      const addedAt = new Date().toISOString();
      for (let i = 0; i < trackIds.length; i += TIDAL_TRACKS_PER_PAGE) {
        const chunk = trackIds.slice(i, i + TIDAL_TRACKS_PER_PAGE);
        await requestWithRetry(
          'post',
          `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
          {
            headers: { ...writeHeaders, 'Idempotency-Key': crypto.randomUUID() },
            params:  { countryCode: cc },
          },
          {
            data: chunk.map(id => ({
              id,
              type: 'tracks',
              meta: { addedAt },
            })),
          },
          3, 'Tidal'
        );
      }
    }
  }

  // Appends tracks to a Tidal playlist (used after createPlaylist for copy/merge/split).
  // POST /relationships/items requires:
  //   - countryCode query param (decoded from the access token)
  //   - Idempotency-Key header (prevents duplicate inserts on retry)
  //   - meta.addedAt per track (ISO timestamp — Tidal records when each track was added)
  //   - meta.positionBefore at the body level (omitted = append at end)
  // Tracks are sent in chunks of TIDAL_TRACKS_PER_PAGE — Tidal enforces a max of 20 items per POST request.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const { cc } = decodeTidalToken(accessToken);
    const addedAt = new Date().toISOString();
    const headers = {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.api+json',
    };

    for (let i = 0; i < trackIds.length; i += TIDAL_TRACKS_PER_PAGE) {
      const chunk = trackIds.slice(i, i + TIDAL_TRACKS_PER_PAGE);
      await requestWithRetry(
        'post',
        `${TIDAL_OPENAPI}/playlists/${playlistId}/relationships/items`,
        {
          headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
          params:  { countryCode: cc },
        },
        {
          data: chunk.map(id => ({
            id,
            type: 'tracks',
            meta: { addedAt },
          })),
        },
        3, 'Tidal'
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
        `${TIDAL_OPENAPI}/playlists/${playlistId}`,
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

  // Accepts both Tidal playlist URL forms and raw UUIDs:
  //   https://tidal.com/browse/playlist/UUID
  //   https://listen.tidal.com/playlist/UUID
  //   UUID directly — same as pasting the ID without a URL prefix
  extractPlaylistId(input: string): string | null {
    const trimmed = input.trim();
    const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
    const urlMatch = trimmed.match(new RegExp(`tidal\\.com(?:\\/browse)?\\/playlist\\/${UUID}`));
    if (urlMatch) return urlMatch[1];
    if (new RegExp(`^${UUID}$`).test(trimmed)) return trimmed;
    return null;
  }
}
