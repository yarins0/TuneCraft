import axios from 'axios';
import prisma from './prisma';
import { isrcLookup } from './isrcLookup';
import type { Platform } from './platform/types';

// Pauses execution for ms milliseconds.
// Used between sequential API calls to stay within external rate limits.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Splits an array into fixed-size chunks.
// Used to batch ReccoBeats requests, which cap at 40 IDs per call.
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
  platformId: string;
  spotifyId: string | null;
  artistId: string;
  artistName: string;
  isrc?: string;
  // The TrackCache column that holds this platform's native ID (e.g. 'spotifyId', 'tidalId').
  // Copied from the adapter's trackCacheIdField so the enrichment pipeline never needs
  // to inspect `platform` directly — any new platform just sets a different idField.
  idField: string;
  // Which streaming platform this track ID came from.
  platform: Platform;
}

// ─── readEnrichmentCache ───────────────────────────────────────────────────────

// Reads audio features and genre tags from the DB cache only — no external API calls.
//
// Returns:
//   audioFeaturesMap   — platformId → cached audio features (only for cache hits)
//   artistGenreMap     — artistId → cached genre tags (only for cache hits)
//   missedTracks       — tracks whose audio features were not in the cache
//   uniqueMissedArtists — deduplicated artists whose genres were not in the cache
//
// Cross-platform deduplication:
//   A single TrackCache row represents one unique recording.
//   When a track has an ISRC that matches a row stored under a different platform's ID,
//   this function returns the existing features and backfills the current platform's ID
//   on that row (fire-and-forget) so future queries can find it without ISRC.
//
// The caller fires backgroundEnrichTracks for misses and returns tracks immediately —
// features are null on the first load but arrive via the /features polling endpoint.
export const readEnrichmentCache = async (
  tracks: EnrichmentTrack[]
): Promise<{
  audioFeaturesMap: Record<string, any>;
  artistGenreMap: Record<string, string[]>;
  missedTracks: EnrichmentTrack[];
  uniqueMissedArtists: { id: string; name: string }[];
}> => {
  // Group platform-native IDs by their DB column name (from track.idField).
  // This replaces per-platform variables — adding a new platform requires no changes here.
  const idsByField: Record<string, string[]> = {};
  for (const t of tracks) {
    if (!idsByField[t.idField]) idsByField[t.idField] = [];
    idsByField[t.idField].push(t.platformId);
  }
  const isrcs     = tracks.filter(t => t.isrc).map(t => t.isrc as string);
  const artistIds = [...new Set(tracks.map(t => t.artistId))];

  // Build OR conditions dynamically from whichever ID columns are present in this batch.
  // Also match by ISRC for cross-platform deduplication.
  const orConditions: object[] = [];
  for (const [field, ids] of Object.entries(idsByField)) {
    if (ids.length > 0) orConditions.push({ [field]: { in: ids } });
  }
  if (isrcs.length > 0) orConditions.push({ isrc: { in: isrcs } });

  const [cachedTracks, cachedArtists] = await Promise.all([
    orConditions.length > 0
      ? prisma.trackCache.findMany({ where: { OR: orConditions } })
      : Promise.resolve([]),
    prisma.artistCache.findMany({ where: { artistId: { in: artistIds } } }),
  ]);

  // Build a platformId → features map.
  // A cache row may be found in three ways:
  //   1. Direct platform ID match via the adapter-declared idField (track already cached on this platform)
  //   2. Direct platform ID match via a different idField (same row, multi-platform)
  //   3. ISRC match (same recording cached under a different platform's ID)
  //      → this is the cross-platform deduplication case
  const audioFeaturesMap: Record<string, any> = {};

  // Collect all unique idFields present in this batch to index cache rows generically.
  const usedIdFields = [...new Set(tracks.map(t => t.idField))];

  for (const row of cachedTracks) {
    const features = sanitizeAudioFeatures(row.audioFeatures);

    // Cases 1 and 2: direct platform ID match via adapter-declared idField.
    // For each idField used in this batch, map the stored native ID to features.
    for (const field of usedIdFields) {
      const id = (row as any)[field];
      if (id) audioFeaturesMap[id] = features;
    }

    // Case 3: ISRC cross-platform hit.
    // The row was found via ISRC but may not yet have the current platform's ID stored.
    // Map the incoming track's platformId to features, and backfill the ID so
    // future requests can find this row by platform ID directly (skipping ISRC lookup).
    if (row.isrc) {
      for (const track of tracks) {
        if (track.isrc !== row.isrc) continue;

        // Map features to this track's native ID (may duplicate a direct-hit; harmless).
        audioFeaturesMap[track.platformId] = features;

        // Backfill: write the native ID onto the row if it is not already there.
        // Fire-and-forget — the polling endpoint will pick it up on the next poll.
        if (!(row as any)[track.idField]) {
          prisma.trackCache
            .update({ where: { id: row.id }, data: { [track.idField]: track.platformId } })
            .catch(() => {});
        }
      }
    }
  }

  const artistGenreMap: Record<string, string[]> = {};
  cachedArtists.forEach(entry => {
    artistGenreMap[entry.artistId] = entry.genres as string[];
  });

  const missedTracks = tracks.filter(t => !audioFeaturesMap[t.platformId]);
  const missedArtists = tracks.filter(t => !artistGenreMap[t.artistId]);
  const uniqueMissedArtists =
    missedArtists.length > 0
      ? [
          ...new Map(
            missedArtists.map(t => [t.artistId, { id: t.artistId, name: t.artistName }])
          ).values(),
        ]
      : [];

  return { audioFeaturesMap, artistGenreMap, missedTracks, uniqueMissedArtists };
};

// ─── backgroundEnrichTracks ───────────────────────────────────────────────────

// Fetches audio features (ReccoBeats) and genre tags (Last.fm) for cache-miss tracks,
// then persists the results. Designed to run as a fire-and-forget background task —
// callers do NOT await this. The next request (or the /features poll) sees the results.
//
// Cross-platform deduplication strategy:
//   Each TrackCache row represents one unique recording — identified by ISRC when available.
//   When a track's ISRC resolves to a Spotify ID that already has a cached row,
//   the upsert by ISRC updates that row to add the native platform ID instead of creating a duplicate.
//   ReccoBeats is therefore never called twice for the same recording across platforms.
//
// Works for all platforms:
//   Platforms whose native ID is a Spotify ID — spotifyId already set (equals platformId).
//   Other platforms — spotifyId starts null; resolved from ISRC via isrcLookup in Phase 0.
//                     Tracks with no ISRC or no Spotify match get no audio features (graceful).
//
// Data flow:
//   ┌──────────────────────────────────────────────────────────────────────────┐
//   │  Phase 0: ISRC → Spotify ID (batches of 3, 500ms gap, non-Spotify only) │
//   │  Phase 1: ReccoBeats batch ID lookup ─┐ (parallel)                      │
//   │           Last.fm genre lookup        ─┘                                │
//   │  Phase 2: Per-track audio features (sequential, 300ms gap, rate limit)  │
//   │  Phase 3: Persist genres to ArtistCache                                 │
//   └──────────────────────────────────────────────────────────────────────────┘
export const backgroundEnrichTracks = async (
  missedTracks: EnrichmentTrack[],
  uniqueMissedArtists: { id: string; name: string }[]
): Promise<void> => {
  console.log('[Enrichment DEBUG] backgroundEnrichTracks called with', missedTracks.length, 'tracks:',
    missedTracks.map(t => ({ platformId: t.platformId, idField: t.idField, isrc: t.isrc ?? '(none)', spotifyId: t.spotifyId }))
  );
  // --- Phase 0: Resolve ISRC → Spotify ID for tracks that need it ---
  //
  // Tracks where spotifyId is already set (Spotify platform) skip this phase entirely.
  // For SoundCloud and Tidal, the track's ISRC is the bridge to a Spotify ID which
  // ReccoBeats requires. Requests are sequential with a 300ms gap between each one.
  //
  // Why sequential (not batched):
  //   Spotify's client credentials token has a strict rate limit on the search endpoint.
  //   Running even 3 concurrent requests reliably triggers a 30s Retry-After penalty.
  //   Sequential with a 300ms gap stays well within the limit for any realistic playlist size.
  const ISRC_DELAY = 300; // ms between sequential ISRC lookups

  const isrcNeedingTracks = missedTracks.filter(t => t.spotifyId === null && t.isrc);
  const noIsrcTracks      = missedTracks.filter(t => t.spotifyId === null && !t.isrc);

  console.log(`[Enrichment DEBUG] Phase 0 — ${isrcNeedingTracks.length} tracks need ISRC→Spotify lookup, ${noIsrcTracks.length} have no ISRC (will get no features)`);

  for (let i = 0; i < isrcNeedingTracks.length; i++) {
    const track = isrcNeedingTracks[i];
    track.spotifyId = await isrcLookup(track.isrc!);
    console.log(`[Enrichment DEBUG] ISRC ${track.isrc} → spotifyId: ${track.spotifyId ?? 'null (no match)'}`);
    if (i < isrcNeedingTracks.length - 1) await sleep(ISRC_DELAY);
  }

  // Only tracks with a resolved Spotify ID can be submitted to ReccoBeats.
  // SoundCloud indie uploads without ISRC will have spotifyId: null — they
  // skip audio feature enrichment and receive null features (displayed gracefully in UI).
  const tracksWithSpotifyId = missedTracks.filter(t => t.spotifyId !== null);
  const spotifyIds = tracksWithSpotifyId.map(t => t.spotifyId as string);

  console.log(`[Enrichment DEBUG] After ISRC phase: ${tracksWithSpotifyId.length}/${missedTracks.length} tracks have a spotifyId → submitting to ReccoBeats`);

  // Build reverse map: spotifyId → platformId for correct TrackCache storage.
  // The polling endpoint (GET /features?ids=...) queries by platform-native ID,
  // so we must store features keyed by platformId — not by the spotifyId used internally.
  const spotifyToPlatformId: Record<string, string> = {};
  tracksWithSpotifyId.forEach(t => {
    spotifyToPlatformId[t.spotifyId as string] = t.platformId;
  });

  // Shape of a single entry returned by the ReccoBeats batch ID endpoint:
  //   href — Spotify track URL (used to extract the Spotify ID)
  //   id   — ReccoBeats internal track ID (used to fetch audio features)
  interface ReccoBeatsIdEntry { href: string; id: string }

  const reccoBeatsIdMap: Record<string, string> = {}; // spotifyId → reccoBeatsId
  let genreResults: { id: string; name: string; genres: string[] }[] = [];

  // --- Phase 1: ReccoBeats batch ID lookup + Last.fm genres in parallel ---
  await Promise.all([
    // ReccoBeats: batch ID lookup (max 40 Spotify IDs per request)
    (async () => {
      if (spotifyIds.length === 0) return;
      const chunks = chunkArray(spotifyIds, 40);

      for (const chunk of chunks) {
        let result: ReccoBeatsIdEntry[] = [];
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

        // ReccoBeats returns { href: "https://api.spotify.com/v1/tracks/{id}", id: "reccoId" }
        // Extract the Spotify ID from the href to build the spotifyId → reccoBeatsId map.
        result.forEach((entry: ReccoBeatsIdEntry) => {
          if (entry?.href && entry?.id) {
            // .pop() is safe here — href is a valid Spotify URL, so it always has a trailing segment
            const spotifyId = entry.href.split('/').pop()!;
            reccoBeatsIdMap[spotifyId] = entry.id;
          }
        });
      }
    })(),

    // Last.fm: genre lookup by artist name (runs for all missed artists, not just those with ISRC)
    (async () => {
      if (uniqueMissedArtists.length === 0) return;
      const results = await Promise.all(
        uniqueMissedArtists.map(({ id, name }) =>
          axios
            .get('https://ws.audioscrobbler.com/2.0/', {
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
                .map((tag: { name: string }) => tag.name.toLowerCase()),
            }))
            .catch(() => ({ id, name, genres: [] as string[] }))
        )
      );
      genreResults.push(...results);
    })(),
  ]);

  // --- Phase 2: Per-track audio feature fetch (sequential — ReccoBeats rate limit) ---
  // Each track is written to TrackCache immediately after its fetch succeeds so the
  // polling client can pick features up one by one as they arrive.
  for (const [spotifyId, reccoId] of Object.entries(reccoBeatsIdMap)) {
    let features: Record<string, unknown> | null = null;

    while (true) {
      try {
        const r = await axios.get(
          `https://api.reccobeats.com/v1/track/${reccoId}/audio-features`
        );
        features = sanitizeAudioFeatures(r.data);
        break;
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429) {
          const wait = Math.min(
            parseInt(err.response?.headers?.['retry-after'] || '5', 10),
            30
          );
          console.warn(`ReccoBeats 429 — waiting ${wait}s (background)`);
          await sleep(wait * 1000);
        } else {
          console.error(
            `ReccoBeats failed for Spotify ID ${spotifyId} (status ${status}) — skipping`
          );
          break;
        }
      }
    }

    if (!features) continue;

    // Retrieve the track object so we know its platform, ISRC, and native platform ID.
    const platformId = spotifyToPlatformId[spotifyId] ?? spotifyId;
    const track = tracksWithSpotifyId.find(t => t.platformId === platformId);
    if (!track) continue;

    console.log(`[Enrichment DEBUG] Phase 2 — writing features for spotifyId=${spotifyId} → ${track.idField}=${platformId} (isrc=${track.isrc ?? 'none'})`);

    // Upsert strategy — keyed by ISRC when available (links the recording across platforms),
    // otherwise keyed by the platform-specific ID column.
    //
    // ISRC upsert (preferred):
    //   create — new row with all known IDs (spotifyId, soundcloudId if SC, isrc)
    //   update — add soundcloudId if this is a SC track hitting a Spotify-created row;
    //            always refresh audioFeatures and cachedAt
    //
    // Platform-ID upsert (fallback, Spotify tracks with no ISRC):
    //   create — new row keyed by spotifyId only
    //   update — refresh audioFeatures and cachedAt
    if (track.isrc) {
      // For non-Spotify platforms, we need to store the native platform ID in addition to
      // the spotifyId that was resolved from ISRC. `nativeIdData` is empty for Spotify
      // because spotifyId is already the native ID and is set unconditionally above.
      const nativeIdData = track.idField !== 'spotifyId'
        ? { [track.idField]: platformId }
        : {};

      prisma.trackCache
        .upsert({
          where: { isrc: track.isrc },
          create: {
            isrc: track.isrc,
            spotifyId: track.spotifyId,
            // Add the originating platform's native ID column (e.g. soundcloudId, tidalId).
            // No-op for Spotify since spotifyId is already set above.
            ...nativeIdData,
            audioFeatures: features as object,
          },
          update: {
            audioFeatures: features as object,
            cachedAt: new Date(),
            // Backfill the native ID onto an existing row sourced from another platform.
            ...nativeIdData,
          },
        })
        .catch(() => {});
    } else {
      // Tracks without ISRC can only be keyed by their Spotify ID (SC tracks without
      // ISRC never reach Phase 2 — they have no spotifyId and are filtered out above).
      prisma.trackCache
        .upsert({
          where: { spotifyId: platformId },
          create: { spotifyId: platformId, audioFeatures: features as object },
          update: { audioFeatures: features as object, cachedAt: new Date() },
        })
        .catch(() => {});
    }

    await sleep(300);
  }

  // --- Phase 3: Persist genre tags to ArtistCache ---
  if (genreResults.length > 0) {
    await Promise.all(
      genreResults.map(({ id, name, genres }) =>
        prisma.artistCache
          .upsert({
            where: { artistId: id },
            update: { genres, cachedAt: new Date() },
            create: { artistId: id, artistName: name, genres },
          })
          .catch(() => {})
      )
    );
  }

  console.log(
    `Background enrichment complete: ${Object.keys(reccoBeatsIdMap).length} track(s) feature-cached`
  );
};
