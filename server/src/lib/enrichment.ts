import prisma from './prisma';
import { isrcLookup } from './isrcLookup';
import { requestWithRetry } from './requestWithRetry';
import type { Platform } from './platform/types';

// Pauses execution for ms milliseconds.
// Used between sequential API calls to stay within external rate limits.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Splits an array into fixed-size chunks.
// Used to batch ReccoBeats requests which cap at 40 IDs per call.
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Strips ReccoBeats-internal fields from audio-feature payloads before storing in TrackCache.
// ReccoBeats echoes back `href` (a Spotify URL), `id` (its own internal track ID), and `isrc`
// in its response — none of which we need to persist. `isrc` already has its own dedicated column.
// Also handles the case where Prisma returns JSON columns as strings — always parses first.
const sanitizeAudioFeatures = (features: unknown): Record<string, unknown> => {
  const parsed = typeof features === 'string' ? JSON.parse(features) : features;
  if (!parsed || typeof parsed !== 'object') return {};
  const { href, id, isrc, ...rest } = parsed as Record<string, unknown>;
  return rest;
};

// Maps a Platform value to the ArtistCache column that stores that platform's artist ID.
// Returns null for platforms that don't yet have a dedicated column.
// This mirrors the `idField` pattern used in EnrichmentTrack for TrackCache.
const artistCacheIdField = (platform: Platform): string | null => {
  switch (platform) {
    case 'SPOTIFY':    return 'spotifyArtistId';
    case 'TIDAL':      return 'tidalArtistId';
    case 'SOUNDCLOUD': return 'soundcloudArtistId';
    default:           return null;
  }
};

// ─── EnrichmentTrack ───────────────────────────────────────────────────────────

// A track ready for audio-feature and genre enrichment.
//
//   platformId — the native ID on the originating platform.
//                Used as the TrackCache lookup key — the browser polls with this ID.
//
//   spotifyId  — the Spotify track ID required by ReccoBeats.
//                Platforms whose native ID is a Spotify ID set this equal to platformId.
//                Other platforms start with null; resolved from ISRC inside backgroundEnrichTracks.
//                If no ISRC match exists, stays null → track gets no audio features.
//
//   isrc       — International Standard Recording Code. Present on commercially released tracks.
//                Provided by each platform via its own metadata field (varies per adapter).
//                Stored in TrackCache so future cross-platform lookups skip ReccoBeats entirely.
export interface EnrichmentTrack {
  platformId:  string;
  spotifyId:   string | null;
  artistId:    string;
  artistName:  string;
  isrc?:       string;
  // The TrackCache column that holds this platform's native ID (e.g. 'spotifyId', 'tidalId').
  // Copied from the adapter's trackCacheIdField so the enrichment pipeline never needs
  // to inspect `platform` directly — any new platform just sets a different idField.
  idField:     string;
  // Which streaming platform this track ID came from.
  platform:    Platform;
}

// ─── ArtistCache lookup helpers ────────────────────────────────────────────────

// Builds Prisma OR conditions to find ArtistCache rows for a batch of tracks.
//
// Three lookup strategies (all combined in one query):
//   1. Per-platform artist ID column (e.g. tidalArtistId) — exact match for this platform
//   2. Legacy artistId field — backward compatibility with rows written before per-platform columns
//   3. normalizedName — cross-platform dedup: a Spotify row is reused for a Tidal artist
//      with the same name, avoiding a second Last.fm call and a duplicate DB row
const buildArtistCacheOrConditions = (tracks: EnrichmentTrack[]): object[] => {
  const conditions: object[] = [];

  // Strategy 1: per-platform ID column
  const idsByField: Record<string, string[]> = {};
  for (const t of tracks) {
    const field = artistCacheIdField(t.platform);
    if (field) {
      if (!idsByField[field]) idsByField[field] = [];
      idsByField[field].push(t.artistId);
    }
  }
  for (const [field, ids] of Object.entries(idsByField)) {
    conditions.push({ [field]: { in: ids } });
  }

  // Strategy 2: legacy artistId column
  const artistIds = [...new Set(tracks.map(t => t.artistId))];
  conditions.push({ artistId: { in: artistIds } });

  // Strategy 3: normalizedName for cross-platform dedup
  const normalizedNames = [...new Set(tracks.map(t => t.artistName.toLowerCase().trim()))];
  conditions.push({ normalizedName: { in: normalizedNames } });

  return conditions;
};

// Builds an artistId → genres map from cached ArtistCache rows.
//
// A row may be found via any of the three strategies above, so we index it by every
// possible key that a track in this batch might look it up by. This ensures a Tidal
// track (tidalArtistId: 'abc') correctly resolves genres from a row that was originally
// stored by Spotify (spotifyArtistId: 'xyz') if both share the same normalizedName.
const buildArtistGenreMap = (
  cachedArtists: any[],
  tracks: EnrichmentTrack[]
): Record<string, string[]> => {
  const map: Record<string, string[]> = {};

  for (const row of cachedArtists) {
    const genres = row.genres as string[];

    // Index by every platform-specific ID stored on the row
    if (row.artistId)            map[row.artistId]            = genres;
    if (row.spotifyArtistId)     map[row.spotifyArtistId]     = genres;
    if (row.tidalArtistId)       map[row.tidalArtistId]       = genres;
    if (row.soundcloudArtistId)  map[row.soundcloudArtistId]  = genres;

    // Cross-platform hit: map the requesting track's artistId when it shares a normalizedName
    if (row.normalizedName) {
      for (const track of tracks) {
        if (track.artistName.toLowerCase().trim() === row.normalizedName) {
          map[track.artistId] = genres;
        }
      }
    }
  }

  return map;
};

// ─── TrackCache lookup helpers ─────────────────────────────────────────────────

// Builds Prisma OR conditions to find TrackCache rows for a batch of tracks.
// Matches by the platform-native ID column and by ISRC for cross-platform hits.
const buildTrackCacheOrConditions = (tracks: EnrichmentTrack[]): object[] => {
  const idsByField: Record<string, string[]> = {};
  for (const t of tracks) {
    if (!idsByField[t.idField]) idsByField[t.idField] = [];
    idsByField[t.idField].push(t.platformId);
  }

  const conditions: object[] = [];
  for (const [field, ids] of Object.entries(idsByField)) {
    if (ids.length > 0) conditions.push({ [field]: { in: ids } });
  }

  const isrcs = tracks.filter(t => t.isrc).map(t => t.isrc as string);
  if (isrcs.length > 0) conditions.push({ isrc: { in: isrcs } });

  return conditions;
};

// Builds a platformId → audio-features map from cached TrackCache rows.
//
// Handles three match cases:
//   1. Direct platform ID match (row found by the adapter's idField)
//   2. Multi-platform direct hit (same row has multiple platform IDs)
//   3. ISRC cross-platform hit — the recording was cached under a different platform's ID.
//      For case 3, the current platform's native ID is backfilled onto the row (fire-and-forget)
//      so future requests can find it by platform ID directly, skipping the ISRC lookup.
const buildAudioFeaturesMap = (
  cachedTracks: any[],
  tracks: EnrichmentTrack[]
): Record<string, any> => {
  const map: Record<string, any> = {};
  const usedIdFields = [...new Set(tracks.map(t => t.idField))];

  for (const row of cachedTracks) {
    const features = sanitizeAudioFeatures(row.audioFeatures);

    // Cases 1 and 2: direct platform ID match
    for (const field of usedIdFields) {
      const id = (row as any)[field];
      if (id) map[id] = features;
    }

    // Case 3: ISRC cross-platform hit
    if (row.isrc) {
      for (const track of tracks) {
        if (track.isrc !== row.isrc) continue;

        // Map features to this track's native ID (may duplicate a direct hit; harmless)
        map[track.platformId] = features;

        // Backfill: write the native ID onto the row if it's not already there.
        // Fire-and-forget — the polling endpoint will pick it up on the next poll.
        if (!(row as any)[track.idField]) {
          prisma.trackCache
            .update({ where: { id: row.id }, data: { [track.idField]: track.platformId } })
            .catch(e => console.error('[Enrichment] TrackCache backfill failed:', e.message));
        }
      }
    }
  }

  return map;
};

// ─── readEnrichmentCache ───────────────────────────────────────────────────────

// Reads audio features and genre tags from the DB cache only — no external API calls.
//
// Returns:
//   audioFeaturesMap    — platformId → cached audio features (only for cache hits)
//   artistGenreMap      — artistId → cached genre tags (only for cache hits)
//   missedTracks        — tracks whose audio features were not in the cache
//   uniqueMissedArtists — deduplicated artists whose genres were not in the cache,
//                         with their originating platform so backgroundEnrichTracks
//                         can store the correct platform-specific artist ID column
//
// The caller fires backgroundEnrichTracks for misses and returns tracks immediately.
// Features are null on the first load but arrive via the /features polling endpoint.
export const readEnrichmentCache = async (
  tracks: EnrichmentTrack[]
): Promise<{
  audioFeaturesMap: Record<string, any>;
  artistGenreMap: Record<string, string[]>;
  missedTracks: EnrichmentTrack[];
  uniqueMissedArtists: { id: string; name: string; platform: Platform }[];
}> => {
  const trackConditions  = buildTrackCacheOrConditions(tracks);
  const artistConditions = buildArtistCacheOrConditions(tracks);

  const [cachedTracks, cachedArtists] = await Promise.all([
    trackConditions.length > 0
      ? prisma.trackCache.findMany({ where: { OR: trackConditions } })
      : Promise.resolve([]),
    prisma.artistCache.findMany({ where: { OR: artistConditions } }),
  ]);

  const audioFeaturesMap = buildAudioFeaturesMap(cachedTracks, tracks);
  const artistGenreMap   = buildArtistGenreMap(cachedArtists, tracks);

  const missedTracks  = tracks.filter(t => !audioFeaturesMap[t.platformId]);
  const missedArtists = tracks.filter(t => !artistGenreMap[t.artistId]);

  // Deduplicate by artistId — one entry per unique missed artist.
  // Carries `platform` so backgroundEnrichTracks can write the correct per-platform ID column.
  const uniqueMissedArtists =
    missedArtists.length > 0
      ? [
          ...new Map(
            missedArtists.map(t => [
              t.artistId,
              { id: t.artistId, name: t.artistName, platform: t.platform },
            ])
          ).values(),
        ]
      : [];

  return { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists };
};

// ─── backgroundEnrichTracks: Phase helpers ─────────────────────────────────────

// Phase 0: Resolves ISRC → Spotify ID for non-Spotify tracks that need it.
// Mutates spotifyId in place on each track object. Spotify tracks and tracks without
// ISRC are skipped — they already have a spotifyId or will never get one.
const resolveIsrcToSpotifyIds = async (tracks: EnrichmentTrack[]): Promise<void> => {
  const ISRC_DELAY = 1000; // ms between lookups — keeps well under Spotify's ~1 req/sec search limit
  const needsLookup = tracks.filter(t => t.spotifyId === null && t.isrc);

  for (let i = 0; i < needsLookup.length; i++) {
    const track = needsLookup[i];
    track.spotifyId = await isrcLookup(track.isrc!);
    if (i < needsLookup.length - 1) await sleep(ISRC_DELAY);
  }
};

// Phase 1a: Fetches ReccoBeats internal IDs for a batch of Spotify IDs.
//
// Returns a map of spotifyId → reccoBeatsId. Tracks not recognised by ReccoBeats are absent.
// Requests are batched at 40 IDs (ReccoBeats cap) with up to 3 retries on 429.
//
// ReccoBeats echoes Spotify IDs inside a `href` URL — we extract the ID from the trailing segment.
const fetchReccoBeatsIds = async (
  spotifyIds: string[]
): Promise<Record<string, string>> => {
  if (spotifyIds.length === 0) return {};

  const idMap: Record<string, string> = {};
  const chunks = chunkArray(spotifyIds, 40);

  for (const chunk of chunks) {
    let result: { href: string; id: string }[] = [];

    try {
      // requestWithRetry handles 429 back-off and up to 3 retries automatically.
      const r = await requestWithRetry(
        'get',
        'https://api.reccobeats.com/v1/track',
        { params: { ids: chunk.join(',') } },
        undefined,
        3,
        'ReccoBeats'
      );
      result = r.data.content || [];
    } catch (err: any) {
      console.error('ReccoBeats ID batch failed:', err.response?.status);
      // On failure, skip this chunk — remaining chunks still run
    }

    for (const entry of result) {
      if (entry?.href && entry?.id) {
        // href format: "https://api.spotify.com/v1/tracks/{spotifyId}"
        const spotifyId = entry.href.split('/').pop()!;
        idMap[spotifyId] = entry.id;
      }
    }
  }

  return idMap;
};

// Last.fm error codes that are safe to retry — all others are permanent failures.
//   8  — Operation failed (generic transient)
//   11 — Service offline temporarily
//   16 — Temporary error processing request
//   29 — Rate limit exceeded (their equivalent of HTTP 429, returned in the body at HTTP 200)
const LASTFM_RETRYABLE_ERRORS = new Set([8, 11, 16, 29]);

// Fetches genre tags for a single artist name from Last.fm, with body-level error handling.
//
// Unlike HTTP APIs, Last.fm signals errors inside the response body at HTTP 200:
//   { "error": 29, "message": "Rate limit exceeded..." }
// requestWithRetry cannot see these — it only watches HTTP status codes.
// This helper inspects the body and retries on rate-limit / transient error codes.
//
// Returns an empty array on any permanent failure — genres are decorative and non-fatal.
const fetchLastFmArtistTags = async (artistName: string, maxRetries = 3): Promise<string[]> => {
  const LASTFM_RETRY_DELAY = 5000; // ms to wait after a body-level rate-limit or transient error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let r: any;

    try {
      r = await requestWithRetry(
        'get',
        'https://ws.audioscrobbler.com/2.0/',
        {
          params: {
            method: 'artist.getTopTags',
            artist: artistName,
            autocorrect: 1,
            api_key: process.env.LASTFM_API_KEY,
            format: 'json',
          },
        },
        undefined,
        1,    // only 1 HTTP-level attempt here — body-level retries are handled by the outer loop
        'Last.fm'
      );
    } catch {
      // HTTP-level failure (network error, non-200 that requestWithRetry gave up on).
      // Treat as a permanent failure — genres are decorative.
      return [];
    }

    // Last.fm signals errors inside the body at HTTP 200.
    // Check for an error code before trying to read toptags.
    const errorCode: number | undefined = r.data?.error;
    if (errorCode) {
      if (LASTFM_RETRYABLE_ERRORS.has(errorCode) && attempt < maxRetries - 1) {
        console.warn(`Last.fm error ${errorCode} for "${artistName}" — retrying in ${LASTFM_RETRY_DELAY / 1000}s`);
        await sleep(LASTFM_RETRY_DELAY);
        continue;
      }
      // Permanent or non-retryable error — log and give up
      console.warn(`Last.fm error ${errorCode} for "${artistName}" — skipping`);
      return [];
    }

    // Success — extract top 3 genre tags
    return (r.data.toptags?.tag || [])
      .slice(0, 3)
      .map((tag: { name: string }) => tag.name.toLowerCase());
  }

  return []; // exhausted all retries
};

// Phase 1b: Fetches genre tags from Last.fm for a list of artists.
//
// Runs all requests in parallel — Last.fm supports concurrent requests.
// Each artist goes through fetchLastFmArtistTags which handles body-level error codes
// (including error 29 — Last.fm's rate limit signal, returned at HTTP 200).
// Carries `platform` through so the upsert step can store the correct platform-specific artist ID.
const fetchArtistGenres = async (
  artists: { id: string; name: string; platform: Platform }[]
): Promise<{ id: string; name: string; platform: Platform; genres: string[] }[]> => {
  if (artists.length === 0) return [];

  return Promise.all(
    artists.map(async ({ id, name, platform }) => ({
      id,
      name,
      platform,
      genres: await fetchLastFmArtistTags(name),
    }))
  );
};

// Phase 2 (per-track): Writes one track's audio features to TrackCache.
//
// Upsert strategy:
//   - With ISRC: upserts by ISRC so the same recording from different platforms shares one row.
//     The originating platform's native ID (e.g. tidalId) is also stored alongside spotifyId.
//   - Without ISRC: upserts by spotifyId only. (SoundCloud tracks without ISRC never reach
//     Phase 2 — they have no spotifyId and are filtered out before this step.)
//
// Fire-and-forget: callers do not await this. Errors are logged but not re-thrown.
const persistAudioFeatures = (
  track: EnrichmentTrack,
  features: Record<string, unknown>
): void => {
  if (track.isrc) {
    // nativeIdData adds the originating platform's column (e.g. tidalId) in addition to spotifyId.
    // No-op for Spotify since spotifyId is the native ID and is already set unconditionally.
    const nativeIdData = track.idField !== 'spotifyId'
      ? { [track.idField]: track.platformId }
      : {};

    prisma.trackCache
      .upsert({
        where: { isrc: track.isrc },
        create: {
          isrc: track.isrc,
          spotifyId: track.spotifyId,
          ...nativeIdData,
          audioFeatures: features as object,
        },
        update: {
          audioFeatures: features as object,
          cachedAt: new Date(),
          ...nativeIdData,
        },
      })
      .catch(e => console.error('[Enrichment] TrackCache upsert failed (isrc):', e.message));
  } else {
    prisma.trackCache
      .upsert({
        where: { spotifyId: track.platformId },
        create: { spotifyId: track.platformId, audioFeatures: features as object },
        update: { audioFeatures: features as object, cachedAt: new Date() },
      })
      .catch(e => console.error('[Enrichment] TrackCache upsert failed (spotifyId):', e.message));
  }
};

// Phase 3: Writes genre tags to ArtistCache.
//
// Primary dedup key: normalizedName (lowercase + trimmed artist name).
// When Spotify and Tidal have different artist IDs for the same person, normalizedName
// ensures they share one ArtistCache row — avoiding a second Last.fm call and a duplicate row.
//
// Per-platform artist ID columns are stored and backfilled onto existing rows, mirroring
// the same cross-platform ID pattern used in TrackCache.
const persistArtistGenres = async (
  results: { id: string; name: string; platform: Platform; genres: string[] }[]
): Promise<void> => {
  if (results.length === 0) return;

  await Promise.all(
    results.map(({ id, name, platform, genres }) => {
      const normalizedName = name.toLowerCase().trim();
      const idField = artistCacheIdField(platform);
      // Stores the originating platform's artist ID in its dedicated column (e.g. tidalArtistId).
      const platformIdData = idField ? { [idField]: id } : {};

      return prisma.artistCache
        .upsert({
          // Upsert by normalizedName — the cross-platform dedup key.
          // Falls back to artistId for the (extremely unlikely) case of an empty artist name.
          where: normalizedName
            ? { normalizedName }
            : { artistId: id },
          create: {
            artistId: id,
            artistName: name,
            normalizedName,
            genres,
            platform: platform as any,
            ...platformIdData,
          },
          update: {
            genres,
            cachedAt: new Date(),
            platform: platform as any,
            ...platformIdData,
          },
        })
        .catch(() => {});
    })
  );
};

// ─── backgroundEnrichTracks ────────────────────────────────────────────────────

// Fetches audio features (ReccoBeats) and genre tags (Last.fm) for cache-miss tracks,
// then persists the results. Designed to run as a fire-and-forget background task —
// callers do NOT await this. The next request (or the /features poll) sees the results.
//
// Cross-platform deduplication:
//   TrackCache  — one row per unique recording, keyed by ISRC.
//   ArtistCache — one row per unique artist, keyed by normalizedName.
//   When a track/artist is already cached from another platform, the existing row is
//   updated to add the new platform's ID instead of creating a duplicate.
//
// Data flow:
//   ┌──────────────────────────────────────────────────────────────────────────┐
//   │  Phase 0: ISRC → Spotify ID (sequential, 1s gap, non-Spotify only)      │
//   │  Phase 1: ReccoBeats batch ID lookup ─┐ (parallel)                      │
//   │           Last.fm genre lookup        ─┘                                │
//   │  Phase 2: Per-track audio features (sequential, 300ms gap, rate limit)  │
//   │  Phase 3: Persist genres to ArtistCache                                 │
//   └──────────────────────────────────────────────────────────────────────────┘

// Tracks whose enrichment is currently in flight (keyed by platformId).
// Prevents duplicate concurrent enrichment — each page reload would otherwise stack
// new ISRC lookups on top of the still-running ones, compounding rate-limit penalties.
const enrichingIds = new Set<string>();

export const backgroundEnrichTracks = async (
  missedTracks: EnrichmentTrack[],
  uniqueMissedArtists: { id: string; name: string; platform: Platform }[]
): Promise<void> => {
  // Skip any tracks already being enriched by a concurrent in-flight call.
  const tracks = missedTracks.filter(t => !enrichingIds.has(t.platformId));
  // Bail early only if there's nothing to do for either tracks OR genres.
  // Genre enrichment can be needed even when all audio features are already cached
  // (e.g. ArtistCache was cleared independently of TrackCache).
  if (tracks.length === 0 && uniqueMissedArtists.length === 0) return;
  tracks.forEach(t => enrichingIds.add(t.platformId));

  try {
    // Phase 0: Resolve ISRC → Spotify ID for non-Spotify tracks.
    await resolveIsrcToSpotifyIds(tracks);

    // Only tracks with a resolved Spotify ID can be submitted to ReccoBeats.
    // Tracks with no ISRC (or failed lookups) skip audio feature enrichment — displayed gracefully.
    const tracksWithSpotifyId = tracks.filter(t => t.spotifyId !== null);
    const spotifyIds = tracksWithSpotifyId.map(t => t.spotifyId as string);

    // Reverse map: spotifyId → track object (for Phase 2 to look up the full track).
    const spotifyIdToTrack: Record<string, EnrichmentTrack> = {};
    tracksWithSpotifyId.forEach(t => { spotifyIdToTrack[t.spotifyId as string] = t; });

    // Phase 1: ReccoBeats ID lookup + Last.fm genres in parallel.
    const [reccoBeatsIdMap, genreResults] = await Promise.all([
      fetchReccoBeatsIds(spotifyIds),
      fetchArtistGenres(uniqueMissedArtists),
    ]);

    // Phase 2: Fetch audio features sequentially (ReccoBeats rate limit).
    // Each track is written to TrackCache immediately so the poller can surface features one by one.
    for (const [spotifyId, reccoId] of Object.entries(reccoBeatsIdMap)) {
      let features: Record<string, unknown> | null = null;

      try {
        // requestWithRetry handles 429 back-off and up to 3 retries automatically.
        const r = await requestWithRetry(
          'get',
          `https://api.reccobeats.com/v1/track/${reccoId}/audio-features`,
          {},
          undefined,
          3,
          'ReccoBeats'
        );
        features = sanitizeAudioFeatures(r.data);
      } catch (err: any) {
        console.error(`ReccoBeats failed for Spotify ID ${spotifyId} (status ${err.response?.status}) — skipping`);
      }

      if (!features) continue;

      const track = spotifyIdToTrack[spotifyId];
      if (!track) continue;

      persistAudioFeatures(track, features);
      await sleep(300);
    }

    // Phase 3: Persist genre tags to ArtistCache.
    await persistArtistGenres(genreResults);

    console.log(
      `Background enrichment complete: ${Object.keys(reccoBeatsIdMap).length} track(s) feature-cached`
    );
  } finally {
    // Always release the lock — even if an error occurs mid-enrichment —
    // so the next page load can retry rather than being permanently blocked.
    tracks.forEach(t => enrichingIds.delete(t.platformId));
  }
};
