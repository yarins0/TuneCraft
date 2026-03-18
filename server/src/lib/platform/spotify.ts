import axios from 'axios';
import prisma from '../prisma';
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
// Used to batch API requests that have a per-call item limit (e.g. Spotify's 100-URI cap).
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Pauses execution for ms milliseconds.
// Used between batched API calls to stay within external rate limits.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wraps any Spotify API call with automatic retry logic for 429 rate-limit responses.
// Reads the Retry-After header (falls back to 5 s, capped at 30 s) and waits before retrying.
// Gives up and re-throws after maxRetries failed attempts.
const spotifyRequestWithRetry = async (
  method: 'get' | 'post' | 'put',
  url: string,
  config: object,
  data?: any,
  maxRetries = 3
): Promise<any> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (method === 'get') return await axios.get(url, config);
      if (method === 'post') return await axios.post(url, data, config);
      if (method === 'put') return await axios.put(url, data, config);
    } catch (error: any) {
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.['retry-after'];
      if (status === 429 && attempt < maxRetries - 1) {
        const waitSeconds = Math.min(retryAfter ? parseInt(retryAfter) : 5, 30);
        console.warn(`Spotify rate limit hit — waiting ${waitSeconds}s (retry ${attempt + 1}/${maxRetries})`);
        await sleep(waitSeconds * 1000);
        continue;
      }
      throw error;
    }
  }
};

// Removes the `href` field that ReccoBeats includes in audio-feature payloads.
// That field is a Spotify link we don't need to store.
const sanitizeAudioFeatures = (features: any) => {
  if (!features || typeof features !== 'object') return {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href, ...rest } = features;
  return rest;
};

// Reads audio features and genre tags from the DB cache only — no external API calls.
// Returns maps for cached tracks plus lists of what's missing, so the caller knows
// what to pass to the background enrichment task.
const readEnrichmentCache = async (
  tracks: { id: string; artistId: string; artistName: string }[]
): Promise<{
  audioFeaturesMap: Record<string, any>;
  artistGenreMap: Record<string, string[]>;
  missedTrackIds: string[];
  missedTracks: { id: string; artistId: string; artistName: string }[];
  uniqueMissedArtists: { id: string; name: string }[];
}> => {
  const trackIds = tracks.map(t => t.id);
  const artistIds = [...new Set(tracks.map(t => t.artistId))];

  const [cachedTracks, cachedArtists] = await Promise.all([
    prisma.trackCache.findMany({ where: { platformTrackId: { in: trackIds } } }),
    prisma.artistCache.findMany({ where: { artistId: { in: artistIds } } }),
  ]);

  const audioFeaturesMap: Record<string, any> = {};
  cachedTracks.forEach(entry => {
    audioFeaturesMap[entry.platformTrackId] = sanitizeAudioFeatures(entry.audioFeatures);
  });

  const artistGenreMap: Record<string, string[]> = {};
  cachedArtists.forEach(entry => {
    artistGenreMap[entry.artistId] = entry.genres as string[];
  });

  const missedTrackIds = trackIds.filter(id => !audioFeaturesMap[id]);
  const missedArtists = tracks.filter(t => !artistGenreMap[t.artistId]);
  const missedTracks = tracks.filter(t => missedTrackIds.includes(t.id));
  const uniqueMissedArtists = missedArtists.length > 0
    ? [...new Map(missedArtists.map(t => [t.artistId, { id: t.artistId, name: t.artistName }])).values()]
    : [];

  return { audioFeaturesMap, artistGenreMap, missedTrackIds, missedTracks, uniqueMissedArtists };
};

// Fetches audio features (ReccoBeats) and genre tags (Last.fm) for cache-miss tracks,
// then persists the results. Intended to run as a fire-and-forget background task —
// callers do NOT await this. The next request for the same tracks will hit the cache.
const backgroundEnrichTracks = async (
  missedTrackIds: string[],
  missedTracks: { id: string; artistId: string; artistName: string }[],
  uniqueMissedArtists: { id: string; name: string }[]
): Promise<void> => {
  const reccoBeatsIdMap: Record<string, string> = {};
  const audioFeaturesMap: Record<string, any> = {};
  let genreResults: { id: string; name: string; genres: string[] }[] = [];

  // Phase 1 — ReccoBeats ID lookup and Last.fm genres in parallel
  await Promise.all([
    // --- ReccoBeats: batch ID lookup ---
    (async () => {
      if (missedTrackIds.length === 0) return;
      const chunks = chunkArray(missedTrackIds, 40);
      const batchResults: any[][] = [];

      for (const chunk of chunks) {
        let result: any[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await axios.get('https://api.reccobeats.com/v1/track', {
              params: { ids: chunk.join(',') },
            });
            result = r.data.content || [];
            break;
          } catch (err: any) {
            if (err.response?.status === 429 && attempt < 2) {
              const wait = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
              console.warn(`ReccoBeats ID batch 429 — waiting ${wait}s`);
              await sleep(wait * 1000);
            } else {
              console.error('ReccoBeats ID batch failed:', err.response?.status);
              break;
            }
          }
        }
        batchResults.push(result);
      }

      batchResults.flat().forEach((feature: any) => {
        if (feature?.href && feature?.id) {
          const spotifyId = feature.href.split('/').pop();
          reccoBeatsIdMap[spotifyId] = feature.id;
        }
      });
    })(),

    // --- Last.fm: genre lookup ---
    (async () => {
      if (uniqueMissedArtists.length === 0) return;
      const results = await Promise.all(
        uniqueMissedArtists.map(({ id, name }) =>
          axios.get('https://ws.audioscrobbler.com/2.0/', {
            params: {
              method: 'artist.getTopTags',
              artist: name,
              api_key: process.env.LASTFM_API_KEY,
              format: 'json',
            },
          })
          .then(r => ({
            id,
            name,
            genres: (r.data.toptags?.tag || [])
              .slice(0, 3)
              .map((tag: any) => tag.name.toLowerCase()),
          }))
          .catch(() => ({ id, name, genres: [] as string[] }))
        )
      );
      genreResults.push(...results);
    })(),
  ]);

  // Phase 2 — fetch individual audio features sequentially to stay within ReccoBeats' rate limit.
  // Each track is written to TrackCache immediately after its fetch succeeds so the polling
  // client can pick features up one by one as they arrive, rather than waiting for the
  // entire loop to finish before anything is written.
  const featureEntries = Object.entries(reccoBeatsIdMap);
  for (const [spotifyId, reccoId] of featureEntries) {
    let features: any = null;
    while (true) {
      try {
        const r = await axios.get(`https://api.reccobeats.com/v1/track/${reccoId}/audio-features`);
        features = sanitizeAudioFeatures(r.data);
        break;
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429) {
          const wait = Math.min(parseInt(err.response?.headers?.['retry-after'] || '5', 10), 30);
          console.warn(`ReccoBeats 429 — waiting ${wait}s before retry (background)`);
          await sleep(wait * 1000);
        } else {
          console.error(`ReccoBeats failed for track ${spotifyId} (status ${status}) — skipping`);
          break;
        }
      }
    }

    // Write to DB immediately on success — the polling client reads from TrackCache every few
    // seconds, so persisting track-by-track lets features appear in the UI as each one arrives.
    if (features) {
      audioFeaturesMap[spotifyId] = features;
      prisma.trackCache.upsert({
        where: { platformTrackId: spotifyId },
        update: { audioFeatures: features, cachedAt: new Date() },
        create: { platformTrackId: spotifyId, audioFeatures: features },
      }).catch(() => {});
    }

    await sleep(300);
  }

  // Persist genre tags to ArtistCache
  if (genreResults.length > 0) {
    await Promise.all(
      genreResults.map(({ id, name, genres }) =>
        prisma.artistCache.upsert({
          where: { artistId: id },
          update: { genres, cachedAt: new Date() },
          create: { artistId: id, artistName: name, genres },
        }).catch(() => {})
      )
    );
  }

  console.log(`Background enrichment complete: ${featureEntries.length} track(s) cached`);
};

// Merges raw Spotify track data with enrichment maps to produce a normalized PlatformTrack.
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

// Returns the Base64-encoded "client_id:client_secret" credential string.
// Spotify requires this in the Authorization header for token exchange and refresh calls.
const spotifyBasicAuth = (): string =>
  'Basic ' + Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

// ─── SpotifyAdapter ─────────────────────────────────────────────────────────────

// Implements PlatformAdapter for Spotify.
// All Spotify-specific API details live here — routes and middleware only call the interface.
export class SpotifyAdapter implements PlatformAdapter {
  readonly platform = 'SPOTIFY' as const;

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
      redirect_uri: process.env.REDIRECT_URI!,
      scope: scopes,
      show_dialog: 'true',
    });

    return `https://accounts.spotify.com/authorize?${params}`;
  }

  // Exchanges a one-time OAuth authorization code for access + refresh tokens.
  // Fetches the user's Spotify profile in the same step to build a complete AuthResult.
  async exchangeCode(code: string): Promise<AuthResult> {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI!,
      }),
      {
        headers: {
          Authorization: spotifyBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

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
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          Authorization: spotifyBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  // Fetches all playlists owned or followed by the authenticated user (up to 50).
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const response = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/playlists', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 50 },
    });

    return response.data.items
      .filter((p: any) => p !== null)
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        trackCount: p.tracks?.total ?? 0,
        imageUrl: p.images?.[0]?.url ?? null,
        ownerId: p.owner.id,
      }));
  }

  // Fetches metadata for a single Spotify playlist by its ID.
  // Used when a user discovers a playlist they don't own via URL paste.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    const response = await spotifyRequestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
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
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    const tracksResponse = await spotifyRequestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      }
    );

    // Filter out null entries and non-track items (e.g. podcast episodes)
    const items = tracksResponse.data.items.filter((item: any) => {
      const track = item.item || item.track;
      return track !== null && track !== undefined && track.type === 'track';
    });

    const rawTracks = items.map((item: any) => item.item || item.track);
    const enrichmentInput = rawTracks.map((t: any) => ({
      id: t.id,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTrackIds, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    // Fire background enrichment for cache misses — don't block the response.
    // Features will be null on this load but cached for the next one.
    if (missedTrackIds.length > 0 || uniqueMissedArtists.length > 0) {
      console.log(`Fetching enrichment for ${missedTrackIds.length} uncached track(s) in background`);
      backgroundEnrichTracks(missedTrackIds, missedTracks, uniqueMissedArtists).catch(err =>
        console.error('Background enrichment error:', err)
      );
    }
    const tracks = rawTracks.map((t: any) => buildTrack(t, audioFeaturesMap, artistGenreMap));

    return { tracks, total: tracksResponse.data.total };
  }

  // Returns the total number of tracks in the user's Liked Songs library.
  // Uses a limit=1 request so no actual track data is transferred — just the total count.
  async fetchLikedCount(accessToken: string): Promise<number> {
    const response = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/tracks', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 1 },
    });
    return response.data.total;
  }

  // Fetches one page of enriched tracks from the user's Liked Songs.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number }> {
    const limit = 50;
    const offset = page * limit;

    const tracksResponse = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/tracks', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit, offset },
    });

    const items = tracksResponse.data.items.filter(
      (item: any) => item.track !== null && item.track.type === 'track'
    );

    const rawTracks = items.map((item: any) => item.track);
    const enrichmentInput = rawTracks.map((t: any) => ({
      id: t.id,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
    }));

    const { audioFeaturesMap, artistGenreMap, missedTrackIds, missedTracks, uniqueMissedArtists } =
      await readEnrichmentCache(enrichmentInput);

    // Fire background enrichment for cache misses — don't block the response.
    // Features will be null on this load but cached for the next one.
    if (missedTrackIds.length > 0 || uniqueMissedArtists.length > 0) {
      console.log(`Fetching enrichment for ${missedTrackIds.length} uncached track(s) in background`);
      backgroundEnrichTracks(missedTrackIds, missedTracks, uniqueMissedArtists).catch(err =>
        console.error('Background enrichment error:', err)
      );
    }
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
      const response = await spotifyRequestWithRetry(
        'get',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit, offset },
        }
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

  // Creates a new empty playlist in the user's Spotify account.
  // Returns the new playlist's generated ID and the owner's Spotify user ID.
  async createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }> {
    const response = await spotifyRequestWithRetry(
      'post',
      'https://api.spotify.com/v1/me/playlists',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { name, description, public: true }
    );

    return {
      id: response.data.id,
      ownerId: response.data.owner.id,
    };
  }

  // Replaces the entire content of a Spotify playlist with a new ordered track list.
  // Handles Spotify's 100-URI-per-request limit internally:
  //   - First request is a PUT (replaces everything with the first 100 tracks)
  //   - Subsequent requests are POSTs (appends remaining tracks in batches)
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const uris = trackIds.map(id => this.formatTrackUri(id));
    const firstChunk = uris.slice(0, 100);
    const remainingChunks = chunkArray(uris.slice(100), 100);

    await spotifyRequestWithRetry(
      'put',
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
      { uris: firstChunk }
    );

    for (const chunk of remainingChunks) {
      await spotifyRequestWithRetry(
        'post',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
        { uris: chunk }
      );
    }
  }

  // Appends tracks to an existing Spotify playlist without replacing existing content.
  // Handles the 100-URI-per-POST limit by chunking automatically.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    const uris = trackIds.map(id => this.formatTrackUri(id));
    const chunks = chunkArray(uris, 100);

    for (const chunk of chunks) {
      await spotifyRequestWithRetry(
        'post',
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        { uris: chunk }
      );
    }
  }

  // Converts a raw Spotify track ID into a Spotify URI.
  // Spotify requires URIs in the format "spotify:track:<id>" for all playlist write operations.
  formatTrackUri(trackId: string): string {
    return `spotify:track:${trackId}`;
  }

  // Paginates through the user's Spotify library to check whether a playlist is still present.
  // Returns true on any error — the cleanup cron should never delete a schedule on uncertainty.
  async playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean> {
    let offset = 0;
    const limit = 20; // small page size to keep each request light

    try {
      while (true) {
        const response = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/playlists', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit, offset },
        });

        const items: any[] = response.data.items ?? [];

        // Found — playlist still exists in the user's library
        if (items.some((p: any) => p?.id === playlistId)) return true;

        // No more pages — playlist was not found
        if (offset + limit >= response.data.total) return false;

        offset += limit;
      }
    } catch {
      // Network error, 5xx, etc. — assume it still exists
      return true;
    }
  }
}
