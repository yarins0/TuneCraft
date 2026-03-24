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

// ─── Helpers ───────────────────────────────────────────────────────────────────

// SoundCloud artwork URLs end in "-large.jpg" which is only 100×100px.
// Replacing the size token with "-t500x500" returns a 500×500 image — much better for display.
// Returns null if the URL is null (many indie tracks have no artwork).
const scArtworkUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  return url.replace('-large', '-t500x500');
};

// SoundCloud API uses numeric integer IDs everywhere.
// We convert them to strings at the boundary so the rest of the app (which uses string IDs)
// never has to think about SoundCloud's integer format.
const scId = (id: number | string): string => String(id);

// Returns the Base64-encoded "client_id:client_secret" credential string.
// SoundCloud requires this in the Authorization header for token exchange and refresh.
const scBasicAuth = (): string =>
  'Basic ' +
  Buffer.from(
    `${process.env.SOUNDCLOUD_CLIENT_ID}:${process.env.SOUNDCLOUD_CLIENT_SECRET}`
  ).toString('base64');

// Authorization header for SoundCloud API calls.
// SoundCloud V1 uses "OAuth {token}" (not "Bearer") for resource requests.
const scAuthHeader = (accessToken: string) => ({ Authorization: `OAuth ${accessToken}` });

// Converts a raw SoundCloud track object into a normalized PlatformTrack.
// SoundCloud has no album concept — albumName is left empty.
// artwork_url is upscaled; missing artwork becomes null.
const buildTrack = (
  raw: any,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>
): PlatformTrack => {
  const id = scId(raw.id);
  const artistId = scId(raw.user.id);
  const features = audioFeaturesMap[id] || {};
  const genres = artistGenreMap[artistId] || [];

  return {
    id,
    name: raw.title,
    artist: raw.user.username,
    albumName: '',
    albumImageUrl: scArtworkUrl(raw.artwork_url),
    durationMs: raw.duration,
    // release_year of 0 means unknown — treat as null
    releaseYear: raw.release_year && raw.release_year > 0 ? raw.release_year : null,
    // SoundCloud has a single 'genre' string field; wrap it in an array to match our schema.
    // Also merge in any Last.fm genres fetched by the enrichment pipeline.
    genres: [
      ...(raw.genre ? [raw.genre.toLowerCase()] : []),
      ...genres.filter((g: string) => g !== raw.genre?.toLowerCase()),
    ],
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

// ─── SoundCloudAdapter ─────────────────────────────────────────────────────────

// Implements PlatformAdapter for SoundCloud.
// All SoundCloud-specific API details live here — routes and middleware call the interface only.
//
// Key differences from Spotify:
//   - Track IDs are integers (converted to strings at the adapter boundary)
//   - Authorization header uses "OAuth {token}", not "Bearer"
//   - No album concept (albumName is empty string)
//   - Audio features require ISRC → Spotify ID lookup before ReccoBeats can be used
//   - replacePlaylistTracks sends the full track list in one PUT (no 100-item chunking)
export class SoundCloudAdapter implements PlatformAdapter {
  readonly platform = 'SOUNDCLOUD' as const;
  readonly trackCacheIdField  = 'soundcloudId';
  readonly artistCacheIdField = 'soundcloudArtistId';

  // Builds the SoundCloud OAuth authorization URL.
  // The user is redirected here when clicking "Connect SoundCloud".
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: process.env.SOUNDCLOUD_CLIENT_ID!,
      redirect_uri: process.env.SOUNDCLOUD_REDIRECT_URI!,
      response_type: 'code',
      scope: '*',
    });

    return `https://secure.soundcloud.com/connect?${params}`;
  }

  // Exchanges a one-time OAuth authorization code for access + refresh tokens.
  // Also fetches the user's SoundCloud profile to build a complete AuthResult.
  async exchangeCode(code: string): Promise<AuthResult> {
    const tokenResponse = await requestWithRetry(
      'post',
      'https://secure.soundcloud.com/oauth2/token',
      {
        headers: {
          Authorization: scBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SOUNDCLOUD_REDIRECT_URI!,
      }),
      3,
      'SoundCloud auth'
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    const profileResponse = await requestWithRetry(
      'get',
      'https://api.soundcloud.com/me',
      { headers: scAuthHeader(access_token) },
      undefined,
      3,
      'SoundCloud'
    );

    const { id, username, full_name, email } = profileResponse.data;

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      // SoundCloud sometimes omits expires_in (tokens valid indefinitely in their classic flow).
      // Fall back to 1 year so the middleware doesn't loop-refresh a non-expiring token.
      expiresAt: expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      platformUserId: scId(id),
      displayName: full_name || username,
      email: email ?? null,
    };
  }

  // Uses a stored refresh token to obtain a new SoundCloud access token.
  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const response = await requestWithRetry(
      'post',
      'https://secure.soundcloud.com/oauth2/token',
      {
        headers: {
          Authorization: scBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      3,
      'SoundCloud auth'
    );

    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expiresAt: expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  // Fetches all playlists in the user's library — both owned and liked/followed.
  //
  //   GET /me/playlists        → playlists the user created
  //   GET /me/likes/playlists  → playlists the user liked (equivalent to Spotify "Following")
  //
  // The two lists are combined and deduplicated by ID in case a user liked their own playlist.
  // /me/likes/playlists is guarded — if SoundCloud V1 doesn't support it, we fall back to
  // owned playlists only rather than crashing.
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const [ownedRes, likedRes] = await Promise.all([
      requestWithRetry(
        'get',
        'https://api.soundcloud.com/me/playlists',
        { headers: scAuthHeader(accessToken), params: { limit: 50 } },
        undefined,
        3,
        'SoundCloud'
      ),
      requestWithRetry(
        'get',
        'https://api.soundcloud.com/me/likes/playlists',
        { headers: scAuthHeader(accessToken), params: { limit: 50 } },
        undefined,
        3,
        'SoundCloud'
      ).catch(() => ({ data: [] })), // endpoint may not exist in all SC API tiers
    ]);

    const toPlaylist = (p: any): PlatformPlaylist => ({
      id: scId(p.id),
      name: p.title,
      trackCount: p.track_count ?? 0,
      imageUrl: scArtworkUrl(p.artwork_url),
      ownerId: scId(p.user.id),
    });

    const owned: PlatformPlaylist[] = (ownedRes.data || []).map(toPlaylist);
    const liked: PlatformPlaylist[] = (likedRes.data || []).map(toPlaylist);

    // Deduplicate: a user might have liked their own playlist — it would appear in both lists.
    const seenIds = new Set(owned.map(p => p.id));
    const uniqueLiked = liked.filter(p => !seenIds.has(p.id));

    return [...owned, ...uniqueLiked];
  }

  // Fetches metadata for a single SoundCloud playlist.
  // Accepts either a numeric playlist ID or a full SoundCloud URL (e.g. soundcloud.com/user/sets/name).
  // When a URL is passed, SoundCloud's /resolve API translates the slug to a numeric ID first.
  // This keeps all SoundCloud-specific resolution logic inside the adapter — the route layer
  // calls fetchPlaylist uniformly regardless of whether the input is an ID or URL.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    let numericId = playlistId;

    // URL slugs can't be used directly — resolve to a numeric ID first.
    if (playlistId.startsWith('https://')) {
      const { default: axios } = await import('axios');
      const resolved = await axios.get('https://api.soundcloud.com/resolve', {
        params: { url: playlistId },
        headers: scAuthHeader(accessToken),
      });
      if (resolved.data.kind !== 'playlist') {
        throw new Error('URL does not point to a SoundCloud playlist');
      }
      numericId = String(resolved.data.id);
    }

    const response = await requestWithRetry(
      'get',
      `https://api.soundcloud.com/playlists/${numericId}`,
      { headers: scAuthHeader(accessToken) },
      undefined,
      3,
      'SoundCloud'
    );

    const p = response.data;
    return {
      id: scId(p.id),
      name: p.title,
      ownerId: scId(p.user.id),
      trackCount: p.track_count ?? 0,
      imageUrl: scArtworkUrl(p.artwork_url),
    };
  }

  // Fetches one page of enriched tracks from a SoundCloud playlist.
  // page=0 → first 50 tracks, page=1 → next 50, etc.
  //
  // Audio features require an extra ISRC → Spotify ID lookup step (handled in backgroundEnrichTracks).
  // Tracks without an ISRC (many indie uploads) will have null audio features — graceful in the UI.
  // signal is forwarded into both parallel requestWithRetry calls so both are cancelled
  // simultaneously when the client drops the HTTP connection.
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number,
    signal?: AbortSignal
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    // Fetch the playlist (for total count) and the track page in parallel.
    const [playlistRes, tracksRes] = await Promise.all([
      requestWithRetry(
        'get',
        `https://api.soundcloud.com/playlists/${playlistId}`,
        { headers: scAuthHeader(accessToken) },
        undefined,
        3,
        'SoundCloud',
        signal
      ),
      requestWithRetry(
        'get',
        `https://api.soundcloud.com/playlists/${playlistId}/tracks`,
        {
          headers: scAuthHeader(accessToken),
          params: { limit, offset },
        },
        undefined,
        3,
        'SoundCloud',
        signal
      ),
    ]);

    const total: number = playlistRes.data.track_count ?? 0;
    const rawTracks: any[] = tracksRes.data || [];

    // Build EnrichmentTrack shape for the shared enrichment pipeline.
    // platformId = SC numeric ID (as string) — used as TrackCache key and by the polling endpoint.
    // spotifyId  = null initially — backgroundEnrichTracks resolves via ISRC lookup.
    // isrc       = from publisher_metadata (present on commercially released tracks only).
    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: scId(t.id),
      spotifyId: null,
      idField: this.trackCacheIdField,
      artistId: scId(t.user.id),
      artistName: t.user.username,
      isrc: t.publisher_metadata?.isrc || undefined,
      platform: 'SOUNDCLOUD' as const,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0 || uniqueMissedArtists.length > 0) {
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[SC] Background enrichment error:', err)
      );
    }

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total };
  }

  // Returns the approximate count of liked tracks for the SoundCloud "Liked Songs" dashboard card.
  // SoundCloud's /me endpoint exposes likes_count which includes all like types (tracks,
  // playlists, etc.) — this is an approximation but sufficient for a card badge.
  async fetchLikedCount(accessToken: string): Promise<number> {
    const response = await requestWithRetry(
      'get',
      'https://api.soundcloud.com/me',
      { headers: scAuthHeader(accessToken) },
      undefined,
      3,
      'SoundCloud'
    );
    return response.data.likes_count ?? 0;
  }

  // Fetches one page of enriched liked tracks from the user's SoundCloud likes.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    // Fetch the user profile (for total likes count) and the track page in parallel.
    const [meRes, tracksRes] = await Promise.all([
      requestWithRetry(
        'get',
        'https://api.soundcloud.com/me',
        { headers: scAuthHeader(accessToken) },
        undefined,
        3,
        'SoundCloud'
      ),
      requestWithRetry(
        'get',
        'https://api.soundcloud.com/me/likes/tracks',
        {
          headers: scAuthHeader(accessToken),
          params: { limit, offset },
        },
        undefined,
        3,
        'SoundCloud'
      ),
    ]);

    const total: number = meRes.data.likes_count ?? 0;
    const rawTracks: any[] = tracksRes.data || [];

    const enrichmentInput: EnrichmentTrack[] = rawTracks.map((t: any) => ({
      platformId: scId(t.id),
      spotifyId: null,
      idField: this.trackCacheIdField,
      artistId: scId(t.user.id),
      artistName: t.user.username,
      isrc: t.publisher_metadata?.isrc || undefined,
      platform: 'SOUNDCLOUD' as const,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    if (missedTracks.length > 0 || uniqueMissedArtists.length > 0) {
      backgroundEnrichTracks(missedTracks, uniqueMissedArtists).catch(err =>
        console.error('[SC] Background enrichment error:', err)
      );
    }

    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));
    return { tracks, total };
  }

  // Fetches ALL tracks in a playlist with minimal data (no enrichment).
  // Used by the auto-reshuffle cron — avoids ReccoBeats/ISRC calls entirely.
  async fetchAllTracksMeta(
    accessToken: string,
    playlistId: string
  ): Promise<PlatformTrackMeta[]> {
    const tracks: PlatformTrackMeta[] = [];
    let offset = 0;
    const limit = 50;

    // Get total track count first so we know when to stop
    const playlistRes = await requestWithRetry(
      'get',
      `https://api.soundcloud.com/playlists/${playlistId}`,
      { headers: scAuthHeader(accessToken) },
      undefined,
      3,
      'SoundCloud'
    );
    const total: number = playlistRes.data.track_count ?? 0;

    while (offset < total) {
      const response = await requestWithRetry(
        'get',
        `https://api.soundcloud.com/playlists/${playlistId}/tracks`,
        {
          headers: scAuthHeader(accessToken),
          params: { limit, offset },
        },
        undefined,
        3,
        'SoundCloud'
      );

      const rawTracks: any[] = response.data || [];
      if (rawTracks.length === 0) break;

      tracks.push(
        ...rawTracks.map((t: any) => ({
          id: scId(t.id),
          artist: t.user.username,
          genres: t.genre ? [t.genre.toLowerCase()] : [],
          releaseYear: t.release_year && t.release_year > 0 ? t.release_year : null,
        }))
      );

      offset += limit;
    }

    return tracks;
  }

  // Creates a new empty playlist in the user's SoundCloud account.
  async createPlaylist(
    accessToken: string,
    name: string,
    _description: string
  ): Promise<{ id: string; ownerId: string }> {
    const response = await requestWithRetry(
      'post',
      'https://api.soundcloud.com/playlists',
      { headers: { ...scAuthHeader(accessToken), 'Content-Type': 'application/json' } },
      { playlist: { title: name, sharing: 'public', tracks: [] } },
      3,
      'SoundCloud'
    );

    return {
      id: scId(response.data.id),
      ownerId: scId(response.data.user.id),
    };
  }

  // Replaces the entire track list of a SoundCloud playlist.
  //
  // Unlike Spotify (which has a 100-URI limit), SoundCloud's PUT endpoint accepts the
  // full list in a single request — no chunking needed. Track IDs must be integers
  // in the body even though we store them as strings everywhere else.
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    await requestWithRetry(
      'put',
      `https://api.soundcloud.com/playlists/${playlistId}`,
      { headers: { ...scAuthHeader(accessToken), 'Content-Type': 'application/json' } },
      { playlist: { tracks: trackIds.map(id => ({ id: parseInt(id, 10) })) } },
      3,
      'SoundCloud'
    );
  }

  // Appends tracks to an existing SoundCloud playlist.
  //
  // SoundCloud's PUT always replaces the entire track list, so we must fetch the
  // current tracks first, merge the new ones in, then write the combined list.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    // Fetch current track list so we can append rather than replace
    const response = await requestWithRetry(
      'get',
      `https://api.soundcloud.com/playlists/${playlistId}`,
      { headers: scAuthHeader(accessToken) },
      undefined,
      3,
      'SoundCloud'
    );

    const existingIds: string[] = (response.data.tracks || []).map((t: any) => scId(t.id));
    const combined = [...existingIds, ...trackIds];

    await this.replacePlaylistTracks(accessToken, playlistId, combined);
  }

  // SoundCloud write operations use plain integer IDs — no URI format needed.
  // This method satisfies the interface contract; the actual integer conversion
  // happens in replacePlaylistTracks and addTracksToPlaylist.
  formatTrackUri(trackId: string): string {
    return trackId;
  }

  // Checks whether a playlist still exists in the user's SoundCloud library.
  // Returns true on any error — the cleanup cron must never delete a schedule on uncertainty.
  async playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean> {
    try {
      await requestWithRetry(
        'get',
        `https://api.soundcloud.com/playlists/${playlistId}`,
        { headers: scAuthHeader(accessToken) },
        undefined,
        3,
        'SoundCloud'
      );
      return true;
    } catch (error: any) {
      // 404 means the playlist was deleted — safe to remove the schedule
      if (error.response?.status === 404) return false;
      // Any other error (network, 5xx, 403) — assume it still exists
      return true;
    }
  }

  // Accepts a SoundCloud playlist URL: soundcloud.com/username/sets/playlist-name
  // The URL slug cannot be resolved to a numeric ID client-side, so we return a
  // normalized https:// URL as a signal to the caller that server-side resolution
  // via the SoundCloud /resolve?url=... endpoint is required.
  extractPlaylistId(input: string): string | null {
    const trimmed = input.trim();
    const match = trimmed.match(
      /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^/?#]+)\/sets\/([^/?#]+)/
    );
    return match ? `https://soundcloud.com/${match[1]}/sets/${match[2]}` : null;
  }
}
