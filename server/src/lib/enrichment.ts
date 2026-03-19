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

// Strips the `href` field that ReccoBeats includes in its audio-feature payloads.
// That field is a Spotify URL we don't need to store. Also handles the case where
// Prisma returns JSON columns as strings on some DB drivers — always parses to object first.
const sanitizeAudioFeatures = (features: unknown): Record<string, unknown> => {
  const parsed = typeof features === 'string' ? JSON.parse(features) : features;
  if (!parsed || typeof parsed !== 'object') return {};
  const { href, ...rest } = parsed as Record<string, unknown>;
  return rest;
};

// ─── EnrichmentTrack ───────────────────────────────────────────────────────────

// A track ready for audio-feature and genre enrichment.
//
//   platformId — the ID on the originating platform (Spotify ID or SoundCloud numeric ID).
//                Used as the TrackCache lookup key — the browser polls with this ID.
//
//   spotifyId  — the Spotify track ID required by ReccoBeats.
//                Spotify:     always equal to platformId.
//                SoundCloud:  null initially; resolved from isrc inside backgroundEnrichTracks.
//                             If no ISRC match exists, stays null → track gets no audio features.
//
//   isrc       — International Standard Recording Code. Present on commercially released tracks.
//                SoundCloud provides this via publisher_metadata.isrc.
//                Spotify provides this via external_ids.isrc.
//                Stored in TrackCache so future cross-platform lookups skip ReccoBeats entirely.
export interface EnrichmentTrack {
  platformId: string;
  spotifyId: string | null;
  artistId: string;
  artistName: string;
  isrc?: string;
  // Which streaming platform this track ID came from — determines which TrackCache column to query/write.
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
//   When a SoundCloud track has an ISRC that matches a row stored via Spotify,
//   this function returns the existing features and backfills the soundcloudId
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
  // Separate platform-native IDs by platform so we query the right columns.
  const spotifyIds = tracks.filter(t => t.platform === 'SPOTIFY').map(t => t.platformId);
  const soundcloudIds = tracks.filter(t => t.platform === 'SOUNDCLOUD').map(t => t.platformId);
  const isrcs = tracks.filter(t => t.isrc).map(t => t.isrc as string);
  const artistIds = [...new Set(tracks.map(t => t.artistId))];

  // Build OR conditions — only include non-empty arrays to avoid Prisma warnings.
  // We match rows by spotifyId, soundcloudId, or ISRC in a single DB round-trip.
  const orConditions: object[] = [];
  if (spotifyIds.length > 0)    orConditions.push({ spotifyId:    { in: spotifyIds } });
  if (soundcloudIds.length > 0) orConditions.push({ soundcloudId: { in: soundcloudIds } });
  if (isrcs.length > 0)         orConditions.push({ isrc:         { in: isrcs } });

  const [cachedTracks, cachedArtists] = await Promise.all([
    orConditions.length > 0
      ? prisma.trackCache.findMany({ where: { OR: orConditions } })
      : Promise.resolve([]),
    prisma.artistCache.findMany({ where: { artistId: { in: artistIds } } }),
  ]);

  // Build a platformId → features map.
  // A cache row may be found in three ways:
  //   1. Direct spotifyId match (Spotify track was already cached)
  //   2. Direct soundcloudId match (SC track was already cached)
  //   3. ISRC match (same recording cached under a different platform ID)
  //      → this is the cross-platform deduplication case
  const audioFeaturesMap: Record<string, any> = {};

  for (const row of cachedTracks) {
    const features = sanitizeAudioFeatures(row.audioFeatures);

    // Cases 1 and 2: direct platform ID match — map the native ID to features.
    if (row.spotifyId)    audioFeaturesMap[row.spotifyId]    = features;
    if (row.soundcloudId) audioFeaturesMap[row.soundcloudId] = features;

    // Case 3: ISRC cross-platform hit.
    // The row was found via ISRC but may not yet have the current platform's ID stored.
    // Map the incoming track's platformId to the features, and backfill the ID so
    // the next request can find this row by platform ID directly (skipping ISRC lookup).
    if (row.isrc) {
      for (const track of tracks) {
        if (track.isrc !== row.isrc) continue;

        // Map features to this track's native ID (may duplicate a case-1/2 hit; harmless).
        audioFeaturesMap[track.platformId] = features;

        // Backfill: link the platform ID to this existing row if it is not already there.
        // Fire-and-forget — the polling endpoint will pick it up on the next poll.
        if (track.platform === 'SOUNDCLOUD' && !row.soundcloudId) {
          prisma.trackCache
            .update({ where: { id: row.id }, data: { soundcloudId: track.platformId } })
            .catch(() => {});
        }
        if (track.platform === 'SPOTIFY' && !row.spotifyId) {
          prisma.trackCache
            .update({ where: { id: row.id }, data: { spotifyId: track.platformId } })
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
//   When a SoundCloud track with ISRC resolves to a Spotify ID that already has a row,
//   the upsert by ISRC updates that row to add the soundcloudId instead of creating a duplicate.
//   ReccoBeats is therefore never called twice for the same recording.
//
// Works for all platforms:
//   Spotify    — spotifyId already set (equals platformId); ISRC passed in from external_ids.
//   SoundCloud — spotifyId starts null; resolved from isrc via isrcLookup in Phase 0.
//                Tracks with no ISRC or no Spotify match get no audio features (graceful).
//
// Data flow:
//   ┌──────────────────────────────────────────────────────────────────────────┐
//   │  Phase 0: ISRC → Spotify ID (sequential, 100ms gap, SC only)            │
//   │  Phase 1: ReccoBeats batch ID lookup ─┐ (parallel)                      │
//   │           Last.fm genre lookup        ─┘                                │
//   │  Phase 2: Per-track audio features (sequential, 300ms gap, rate limit)  │
//   │  Phase 3: Persist genres to ArtistCache                                 │
//   └──────────────────────────────────────────────────────────────────────────┘
export const backgroundEnrichTracks = async (
  missedTracks: EnrichmentTrack[],
  uniqueMissedArtists: { id: string; name: string }[]
): Promise<void> => {
  // --- Phase 0: Resolve ISRC → Spotify ID for tracks that need it ---
  // Sequential with a small delay to avoid hammering the Spotify search endpoint.
  // Tracks where spotifyId is already set (Spotify platform) skip this phase entirely.
  for (const track of missedTracks) {
    if (track.spotifyId === null && track.isrc) {
      track.spotifyId = await isrcLookup(track.isrc);
      await sleep(100);
    }
  }

  // Only tracks with a resolved Spotify ID can be submitted to ReccoBeats.
  // SoundCloud indie uploads without ISRC will have spotifyId: null — they
  // skip audio feature enrichment and receive null features (displayed gracefully in UI).
  const tracksWithSpotifyId = missedTracks.filter(t => t.spotifyId !== null);
  const spotifyIds = tracksWithSpotifyId.map(t => t.spotifyId as string);

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
      prisma.trackCache
        .upsert({
          where: { isrc: track.isrc },
          create: {
            isrc: track.isrc,
            spotifyId: track.spotifyId,
            // Only set soundcloudId if the track came from SoundCloud (platformId is the SC ID).
            soundcloudId: track.platform === 'SOUNDCLOUD' ? platformId : null,
            audioFeatures: features as object,
          },
          update: {
            audioFeatures: features as object,
            cachedAt: new Date(),
            // Add the SC ID to an existing Spotify-sourced row when a SC track triggers this upsert.
            ...(track.platform === 'SOUNDCLOUD' ? { soundcloudId: platformId } : {}),
            // Add the Spotify ID to an existing SC-sourced row (should not occur in practice).
            ...(track.platform === 'SPOTIFY' ? { spotifyId: track.spotifyId } : {}),
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
