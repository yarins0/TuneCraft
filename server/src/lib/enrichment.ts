import axios from 'axios';
import prisma from './prisma';
import { isrcLookup } from './isrcLookup';

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
const sanitizeAudioFeatures = (features: any): object => {
  const parsed = typeof features === 'string' ? JSON.parse(features) : features;
  if (!parsed || typeof parsed !== 'object') return {};
  const { href, ...rest } = parsed;
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
//                Used to cross-reference the track to a Spotify ID for ReccoBeats.
export interface EnrichmentTrack {
  platformId: string;
  spotifyId: string | null;
  artistId: string;
  artistName: string;
  isrc?: string;
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
  const platformIds = tracks.map(t => t.platformId);
  const artistIds = [...new Set(tracks.map(t => t.artistId))];

  const [cachedTracks, cachedArtists] = await Promise.all([
    prisma.trackCache.findMany({ where: { platformTrackId: { in: platformIds } } }),
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
// Works for all platforms:
//   Spotify    — spotifyId already set (equals platformId); ISRC step is skipped.
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
//   │  Storage: TrackCache keyed by platformId (NOT spotifyId)                │
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
  // The polling endpoint (GET /features?ids=...) queries by platformId, so we
  // must store features keyed by platformId — not by the spotifyId used internally.
  const spotifyToPlatformId: Record<string, string> = {};
  tracksWithSpotifyId.forEach(t => {
    spotifyToPlatformId[t.spotifyId as string] = t.platformId;
  });

  const reccoBeatsIdMap: Record<string, string> = {}; // spotifyId → reccoBeatsId
  let genreResults: { id: string; name: string; genres: string[] }[] = [];

  // --- Phase 1: ReccoBeats batch ID lookup + Last.fm genres in parallel ---
  await Promise.all([
    // ReccoBeats: batch ID lookup (max 40 Spotify IDs per request)
    (async () => {
      if (spotifyIds.length === 0) return;
      const chunks = chunkArray(spotifyIds, 40);

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

        // ReccoBeats returns { href: "https://api.spotify.com/v1/tracks/{id}", id: "reccoId" }
        // Extract the Spotify ID from the href to build the spotifyId → reccoBeatsId map.
        result.forEach((feature: any) => {
          if (feature?.href && feature?.id) {
            const spotifyId = feature.href.split('/').pop();
            reccoBeatsIdMap[spotifyId] = feature.id;
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
                .map((tag: any) => tag.name.toLowerCase()),
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
    let features: any = null;

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

    if (features) {
      // Always store by platformId — for Spotify this equals spotifyId,
      // for SoundCloud it's the SC numeric ID (what the browser polls with).
      const platformId = spotifyToPlatformId[spotifyId] ?? spotifyId;

      prisma.trackCache
        .upsert({
          where: { platformTrackId: platformId },
          update: { audioFeatures: features, cachedAt: new Date() },
          create: { platformTrackId: platformId, audioFeatures: features },
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
