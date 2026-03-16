import { Router } from 'express';
import axios from 'axios';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import prisma from '../lib/prisma';

const router = Router();

const sanitizeAudioFeatures = (features: any) => {
  if (!features || typeof features !== 'object') return {};
  // ReccoBeats includes `href` (Spotify track link); we don't need to store/return it.
  // Keep the rest of the payload untouched.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href, ...rest } = features;
  return rest;
};

// Splits an array into chunks of a given size.
// Used to batch API requests so we never send more than `size` items at once.
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Pauses execution for `ms` milliseconds.
// Used between batched API calls to stay within external rate limits.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wraps any axios call to Spotify with automatic retry logic for rate limiting.
// When Spotify responds with 429 (Too Many Requests), it reads the Retry-After
// header and waits that many seconds before trying again.
// Falls back to a 5 second wait if the header is missing.
// Gives up and re-throws the error after maxRetries failed attempts.
//
// The `method` parameter accepts 'get', 'post', or 'put'.
// The `data` parameter is the request body — only used for POST and PUT.
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

      if (status === 429 && attempt < maxRetries) {
        const waitSeconds = Math.min(retryAfter ? parseInt(retryAfter) : 5, 30);
        console.warn(`Spotify rate limit hit (status: 429) - Blocked for ${retryAfter} seconds.`);
        console.warn(`Waiting ${waitSeconds}s before retry ${attempt + 1} of ${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        continue;
      }
      if (status !== 429) 
        throw error;
    }
  }
};

// A serial queue for all Spotify write requests (POST/PUT).
// Spotify's rate limit applies per rolling 30-second window across the entire app —
// if two write routes fire simultaneously they both hit 429 at once and retry
// simultaneously, causing a cascade. This queue ensures only one write sequence
// runs at a time by chaining each caller onto the previous one's Promise tail.
let spotifyWriteQueue = Promise.resolve();

const enqueueSpotifyWrite = <T>(fn: () => Promise<T>): Promise<T> => {
  const result = spotifyWriteQueue.then(fn);
  // Replace the queue tail — even if fn rejects, the queue must continue for future callers
  spotifyWriteQueue = result.then(() => {}, () => {});
  return result;
};

// Fetches audio features and genres for a list of tracks
// Checks the database cache first — only calls external APIs for cache misses
// Stores new results in the cache for future requests
const fetchTrackEnrichment = async (
  tracks: { id: string; artistId: string; artistName: string }[]
): Promise<{
  audioFeaturesMap: Record<string, any>;
  artistGenreMap: Record<string, string[]>;
}> => {
  const trackIds = tracks.map(t => t.id);
  const artistIds = [...new Set(tracks.map(t => t.artistId))];

  // Check both caches in parallel
  const [cachedTracks, cachedArtists] = await Promise.all([
    prisma.trackCache.findMany({ where: { spotifyId: { in: trackIds } } }),
    prisma.artistCache.findMany({ where: { artistId: { in: artistIds } } }),
  ]);

  // Build lookup maps from cache results
  const audioFeaturesMap: Record<string, any> = {};
  cachedTracks.forEach(entry => {
    audioFeaturesMap[entry.spotifyId] = sanitizeAudioFeatures(entry.audioFeatures);
  });

  const artistGenreMap: Record<string, string[]> = {};
  cachedArtists.forEach(entry => {
    artistGenreMap[entry.artistId] = entry.genres as string[];
  });

  // Find cache misses
  const missedTrackIds = trackIds.filter(id => !audioFeaturesMap[id]);
  const missedArtists = tracks.filter(t => !artistGenreMap[t.artistId]);
  const missedTracks = tracks.filter(t => missedTrackIds.includes(t.id));

  // Phase 1 — fetch ReccoBeats IDs and Last.fm genres concurrently.
  // These hit completely independent APIs with separate rate limits, so there is no
  // reason to wait for one to finish before starting the other.
  // Within each API, requests are still sequential with a 300ms gap between batches.
  const reccoBeatsIdMap: Record<string, string> = {};
  let genreResults: { id: string; name: string; genres: string[] }[] = [];

  const uniqueMissedArtists = missedArtists.length > 0
    ? [...new Map(missedArtists.map(t => [t.artistId, { id: t.artistId, name: t.artistName }])).values()]
    : [];

  await Promise.all([
    // --- ReccoBeats: batch ID lookup (chunks of 40, sequential, retry on 429) ---
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

    // --- Last.fm: genre lookup (all artists in parallel — separate API, independent limit) ---
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

  // Phase 2 — fetch individual audio features from ReccoBeats using the IDs from phase 1.
  // Capped at 20 concurrent requests to avoid bursting into ReccoBeats' rate limit.
  // For a 50-track page this means ~3 waves (~1s total). Each request retries once on 429,
  // waiting at most 10s (Retry-After capped) before giving up.
  if (missedTrackIds.length > 0) {
    const featureEntries = Object.entries(reccoBeatsIdMap);
    const MAX_CONCURRENT = 20;
    let active = 0;
    const waiters: (() => void)[] = [];
    const runNext = () => { if (waiters.length > 0) waiters.shift()!(); };

    const fetchWithLimit = ([spotifyId, reccoId]: [string, string]) =>
      new Promise<void>(resolve => {
        const run = async () => {
          active++;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const r = await axios.get(`https://api.reccobeats.com/v1/track/${reccoId}/audio-features`);
              audioFeaturesMap[spotifyId] = sanitizeAudioFeatures(r.data);
              break;
            } catch (err: any) {
              const status = err.response?.status;
              if (status === 429 && attempt === 0) {
                const wait = Math.min(parseInt(err.response?.headers?.['retry-after'] || '2', 10), 10);
                console.warn(`ReccoBeats 429 — waiting ${wait}s before retry`);
                await sleep(wait * 1000);
              } else {
                console.error('ReccoBeats audio features failed:', status);
                break;
              }
            }
          }
          active--;
          runNext();
          resolve();
        };
        if (active < MAX_CONCURRENT) run();
        else waiters.push(run);
      });

    await Promise.all(featureEntries.map(fetchWithLimit));

    // Persist newly fetched audio features to TrackCache
    await Promise.all(
      missedTracks.map(track =>
        prisma.trackCache.upsert({
          where: { spotifyId: track.id },
          update: { audioFeatures: audioFeaturesMap[track.id] || {}, cachedAt: new Date() },
          create: { spotifyId: track.id, audioFeatures: audioFeaturesMap[track.id] || {} },
        }).catch(() => {})
      )
    );
  }

  // Save newly fetched genres to ArtistCache (always runs, guarded by genreResults length)
  if (genreResults.length > 0) {

    // Save missed artists to ArtistCache
    await Promise.all(
      genreResults.map(({ id, name, genres }) => {
        artistGenreMap[id] = genres;
        return prisma.artistCache.upsert({
          where: { artistId: id },
          update: { genres, cachedAt: new Date() },
          create: { artistId: id, artistName: name, genres },
        }).catch(() => {});
      })
    );
  }

  return { audioFeaturesMap, artistGenreMap };
};

// Shapes raw track data from Spotify into a clean track object
// Works for both playlist items (item.item) and liked songs (item.track)
const formatTrack = (
  rawTrack: any,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>
) => {
  const features = audioFeaturesMap[rawTrack.id] || {};
  const genres = artistGenreMap[rawTrack.artists[0].id] || [];

  const result = {
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
  
  return result;
};

// Calculates the average value of each audio feature across all tracks
const calculateAverages = (tracks: any[]) => {
  const average = (key: string) => {
    const values = tracks
      .map((t: any) => t.audioFeatures[key])
      .filter((v: any) => v !== null);
    return values.length
      ? Math.round((values.reduce((a: number, b: number) => a + b, 0) / values.length) * 100) / 100
      : null;
  };

  return {
    energy: average('energy'),
    danceability: average('danceability'),
    valence: average('valence'),
    acousticness: average('acousticness'),
    instrumentalness: average('instrumentalness'),
    speechiness: average('speechiness'),
    tempo: Math.round(
      tracks.reduce((sum: number, t: any) => sum + (t.audioFeatures.tempo ?? 0), 0) / tracks.length
    ),
  };
};

// GET /playlists/:userId
// Fetches all Spotify playlists for a given Tunecraft user
router.get('/:userId', refreshTokenMiddleware, async (req, res) => {
  try {
    const accessToken = (req as any).accessToken;

    const response = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/playlists', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 50 },
    });

    const playlists = response.data.items
      .filter((playlist: any) => playlist !== null)
      .map((playlist: any) => ({
        spotifyId: playlist.id,
        name: playlist.name,
        trackCount: playlist.items?.total ?? 0,
        imageUrl: playlist.images?.[0]?.url ?? null,
        ownerId: playlist.owner.id,
      }));

    res.json({ playlists });

  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// GET /playlists/:userId/discover/:playlistId
// Fetches metadata for any public Spotify playlist by ID
// Used when a user pastes a URL or ID they don't own
router.get('/:userId/discover/:playlistId', refreshTokenMiddleware, async (req, res) => {
  const { playlistId } = req.params;
  const accessToken = (req as any).accessToken;

  try {
    const response = await spotifyRequestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const playlist = response.data;

    res.json({
      spotifyId: playlist.id,
      name: playlist.name,
      ownerId: playlist.owner.id,
      trackCount: playlist.tracks?.total ?? 0,
      imageUrl: playlist.images?.[0]?.url ?? null,
    });

  } catch (error: any) {
    const status = error.response?.status;
    if (status === 404) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (status === 403) {
      return res.status(403).json({ error: 'This playlist is private' });
    }
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// GET /playlists/:userId/liked
// Fetches the Liked Songs count for the dashboard card
// Liked Songs are not included in /me/playlists so they require a separate call
router.get('/:userId/liked', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;

  try {
    const response = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/tracks', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 1 },
    });

    res.json({
      playlist: {
        spotifyId: 'liked',
        name: 'Liked Songs',
        trackCount: response.data.total,
        imageUrl: null,
        isLiked: true,
      }
    });

  } catch (error: any) {
    console.error('Failed to fetch liked songs:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked songs' });
  }
});

// GET /playlists/:userId/liked/tracks
// Fetches a single page of tracks from the user's Liked Songs
// Supports pagination via ?page= query parameter
router.get('/:userId/liked/tracks', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;
  const page = parseInt(req.query.page as string) || 0;
  const limit = 50;
  const offset = page * limit;

  try {
    const tracksResponse = await spotifyRequestWithRetry('get', 'https://api.spotify.com/v1/me/tracks', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit, offset },
    });

    const items = tracksResponse.data.items.filter(
      (item: any) => item.track !== null && item.track.type === 'track'
    );

    const rawTracks = items.map((item: any) => item.track);

    const trackEnrichmentInput = rawTracks.map((t: any) => ({
      id: t.id,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
    }));

    const { audioFeaturesMap, artistGenreMap } = await fetchTrackEnrichment(trackEnrichmentInput);

    const tracks = rawTracks.map((t: any) => formatTrack(t, audioFeaturesMap, artistGenreMap));

    res.json({
      tracks,
      playlistAverages: calculateAverages(tracks),
      total: tracksResponse.data.total,
      hasMore: offset + limit < tracksResponse.data.total,
      nextPage: page + 1,
    });

  } catch (error: any) {
    console.error('Failed to fetch liked tracks:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch liked tracks' });
  }
});

// GET /playlists/:userId/:spotifyId/tracks
// Fetches a single page of tracks for a playlist with audio features and genres
// Supports pagination via ?page= query parameter
router.get('/:userId/:spotifyId/tracks', refreshTokenMiddleware, async (req, res) => {
  const spotifyId = req.params.spotifyId as string;
  const accessToken = (req as any).accessToken;
  const page = parseInt(req.query.page as string) || 0;
  const limit = 50;
  const offset = page * limit;

  try {
    const tracksResponse = await spotifyRequestWithRetry(
      'get',
      `https://api.spotify.com/v1/playlists/${spotifyId}/items`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      }
    );

    const items = tracksResponse.data.items.filter((item: any) => {
      const track = item.item || item.track;
      return track !== null && track !== undefined && track.type === 'track';
    });

    const rawTracks = items.map((item: any) => item.item || item.track);

    const trackEnrichmentInput = rawTracks.map((t: any) => ({
      id: t.id,
      artistId: t.artists[0].id,
      artistName: t.artists[0].name,
    }));

    const { audioFeaturesMap, artistGenreMap } = await fetchTrackEnrichment(trackEnrichmentInput);

    const tracks = rawTracks.map((t: any) => formatTrack(t, audioFeaturesMap, artistGenreMap));

    res.json({
      tracks,
      playlistAverages: calculateAverages(tracks),
      total: tracksResponse.data.total,
      hasMore: offset + limit < tracksResponse.data.total,
      nextPage: page + 1,
    });

  } catch (error: any) {
    console.error('Failed to fetch tracks:', error.response?.data || error.message);

    if (error.response?.status === 403) {
      return res.status(403).json({
        error: "This playlist can't be accessed. Spotify restricts access to playlists owned by other users in development mode."
      });
    }

    res.status(500).json({ error: 'Failed to fetch playlist tracks' });
  }
});

// POST /playlists/:userId/:spotifyId/shuffle
// Saves a pre-shuffled track order to an owned Spotify playlist
// The shuffle algorithm runs on the frontend; this route just writes the result to Spotify
router.post('/:userId/:spotifyId/shuffle', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;
  const spotifyId = req.params.spotifyId as string;
  const { tracks } = req.body;
  const accessToken = (req as any).accessToken;

  try {
    const uris = tracks.map((t: any) => `spotify:track:${t.id}`);

    // Spotify limits PUT /playlists/:id/items to 100 URIs per request
    // First PUT replaces the entire playlist with the first 100 tracks
    const firstChunk = uris.slice(0, 100);
    const remainingChunks = chunkArray(uris.slice(100), 100);

    await enqueueSpotifyWrite(async () => {
      await spotifyRequestWithRetry(
        'put',
        `https://api.spotify.com/v1/playlists/${spotifyId}/items`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
        { uris: firstChunk }
      );

      // Subsequent POSTs append the remaining tracks in batches of 100
      for (const chunk of remainingChunks) {
        await spotifyRequestWithRetry(
          'post',
          `https://api.spotify.com/v1/playlists/${spotifyId}/items`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
          { uris: chunk }
        );
      }
    });

    // If this playlist has an active auto-reshuffle schedule, update the timestamps
    // so the cron job doesn't re-shuffle it again shortly after a manual shuffle.
    // Runs after the response is sent — a failure here doesn't affect the shuffle result.
    prisma.playlist.findUnique({
      where: { userId_spotifyPlaylistId: { userId, spotifyPlaylistId: spotifyId } },
      select: { autoReshuffle: true, intervalDays: true },
    }).then(schedule => {
      if (!schedule?.autoReshuffle || !schedule.intervalDays) return;
      const now = new Date();
      const nextReshuffleAt = new Date(now);
      nextReshuffleAt.setDate(nextReshuffleAt.getDate() + schedule.intervalDays);
      return prisma.playlist.update({
        where: { userId_spotifyPlaylistId: { userId, spotifyPlaylistId: spotifyId } },
        data: { lastReshuffledAt: now, nextReshuffleAt },
      });
    }).catch(err => {
      console.error('Failed to update reshuffle timestamps after manual shuffle:', err);
    });

    res.json({ success: true });

  } catch (error: any) {
    const status = error.response?.status;

    // Playlist was deleted from Spotify but its auto-reshuffle record still exists in our DB.
    // Clean it up so the cron job doesn't keep trying to reshuffle a playlist that is gone.
    if (status === 404) {
      await prisma.playlist.deleteMany({
        where: { userId, spotifyPlaylistId: spotifyId },
      }).catch(dbErr => {
        console.error('Failed to remove deleted playlist from DB:', dbErr);
      });
      return res.status(404).json({ error: 'Playlist not found on Spotify — it may have been deleted' });
    }

    console.error('Failed to shuffle playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to shuffle playlist' });
  }
});

// POST /playlists/:userId/copy
// Creates a new playlist in the user's Spotify library as a copy of any playlist
// Used when the user wants to shuffle a playlist they don't own
router.post('/:userId/copy', refreshTokenMiddleware, async (req, res) => {
  const { tracks, name } = req.body;
  const accessToken = (req as any).accessToken;

  try {
    // Add tracks in batches of 100 (Spotify's limit per request)
    const uris = tracks.map((t: any) => `spotify:track:${t.id}`);
    const chunks = chunkArray(uris, 100);

    const { newPlaylistId, newPlaylistOwnerId } = await enqueueSpotifyWrite(async () => {
      // Create a new empty playlist
      const createResponse = await spotifyRequestWithRetry(
        'post',
        'https://api.spotify.com/v1/me/playlists',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        {
          name: name,
          description: 'Created by Tunecraft',
          public: true,
        }
      );

      const newPlaylistId = createResponse.data.id;
      const newPlaylistOwnerId = createResponse.data.owner.id;

      for (const chunk of chunks) {
        await spotifyRequestWithRetry(
          'post',
          `https://api.spotify.com/v1/playlists/${newPlaylistId}/items`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          { uris: chunk }
        ).catch((err: any) => {
          console.error('Failed to add chunk:', err.response?.data || err.message);
        });
      }

      return { newPlaylistId, newPlaylistOwnerId };
    });

    res.json({
      success: true,
      playlist: {
        spotifyId: newPlaylistId,
        name: name,
        ownerId: newPlaylistOwnerId,
      },
    });

  } catch (error: any) {
    console.error('Failed to copy playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to copy playlist' });
  }
});

// POST /playlists/:userId/merge
// Creates a new playlist from a pre-built merged track list
// The frontend is responsible for fetching all tracks and deduplicating before calling this route
// This endpoint only handles creating the Spotify playlist and adding the tracks in batches
router.post('/:userId/merge', refreshTokenMiddleware, async (req, res) => {
  const { tracks, name } = req.body;
  const accessToken = (req as any).accessToken;

  try {
    // Add tracks in batches of 100 (Spotify's per-request limit)
    const uris = tracks.map((t: any) => `spotify:track:${t.id}`);
    const chunks = chunkArray(uris, 100);

    const { newPlaylistId, newPlaylistOwnerId } = await enqueueSpotifyWrite(async () => {
      // Create a new empty playlist in the user's Spotify account
      const createResponse = await spotifyRequestWithRetry(
        'post',
        'https://api.spotify.com/v1/me/playlists',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        {
          name,
          description: 'Merged by Tunecraft',
          public: true,
        }
      );

      const newPlaylistId = createResponse.data.id;
      const newPlaylistOwnerId = createResponse.data.owner.id;

      for (const chunk of chunks) {
        await spotifyRequestWithRetry(
          'post',
          `https://api.spotify.com/v1/playlists/${newPlaylistId}/items`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          { uris: chunk }
        ).catch((err: any) => {
          console.error('Failed to add chunk to merged playlist:', err.response?.data || err.message);
        });
      }

      return { newPlaylistId, newPlaylistOwnerId };
    });

    res.json({
      success: true,
      playlist: {
        spotifyId: newPlaylistId,
        name,
        ownerId: newPlaylistOwnerId,
      },
    });

  } catch (error: any) {
    console.error('Failed to merge playlists:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to merge playlists' });
  }
});

// POST /playlists/:userId/split
// Receives an array of named groups, each containing a list of track IDs
// Creates one new Spotify playlist per group and populates each with its tracks
router.post('/:userId/split', refreshTokenMiddleware, async (req, res) => {
  const { groups } = req.body as {
    groups: { name: string; tracks: { id: string }[]; description: string}[];
  };
  const accessToken = (req as any).accessToken;

  try {
    const created = await enqueueSpotifyWrite(async () => {
      // Process each group sequentially to avoid hammering the Spotify API
      // Each group becomes its own playlist in the user's library
      const created = [];

      for (const group of groups) {
        // Create an empty playlist for this group
        const createResponse = await spotifyRequestWithRetry(
          'post',
          'https://api.spotify.com/v1/me/playlists',
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            name: group.name,
            description: `${group.description}  - Created by TuneCraft Split`,
            public: true,
          }
        );

        const newPlaylistId = createResponse.data.id;
        const newPlaylistOwnerId = createResponse.data.owner.id;

        // Add this group's tracks in batches of 100 (Spotify's per-request limit)
        const uris = group.tracks.map((t: any) => `spotify:track:${t.id}`);
        const chunks = chunkArray(uris, 100);

        for (const chunk of chunks) {
          await spotifyRequestWithRetry(
            'post',
            `https://api.spotify.com/v1/playlists/${newPlaylistId}/items`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
            { uris: chunk }
          ).catch((err: any) => {
            console.error(`Failed to add chunk to split playlist "${group.name}":`, err.response?.data || err.message);
          });
        }

        created.push({
          spotifyId: newPlaylistId,
          name: group.name,
          ownerId: newPlaylistOwnerId,
        });
      }

      return created;
    });

    res.json({ success: true, playlists: created });

  } catch (error: any) {
    console.error('Failed to split playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to split playlist' });
  }
});

// PUT /playlists/:userId/:spotifyId/save
// Saves the current track order to an owned Spotify playlist
// Sends tracks in batches of 100 (Spotify's limit per request)
router.put('/:userId/:spotifyId/save', refreshTokenMiddleware, async (req, res) => {
  const { spotifyId } = req.params;
  const { tracks } = req.body;
  const accessToken = (req as any).accessToken;

  try {
    const uris = tracks.map((t: any) => `spotify:track:${t.id}`);
    const firstChunk = uris.slice(0, 100);
    const remainingChunks = chunkArray(uris.slice(100), 100);

    await enqueueSpotifyWrite(async () => {
      // First PUT replaces entire playlist with first 100 tracks
      await spotifyRequestWithRetry(
        'put',
        `https://api.spotify.com/v1/playlists/${spotifyId}/items`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
        { uris: firstChunk }
      );

      // Subsequent POSTs append remaining tracks
      for (const chunk of remainingChunks) {
        await spotifyRequestWithRetry(
          'post',
          `https://api.spotify.com/v1/playlists/${spotifyId}/items`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
          { uris: chunk }
        );
      }
    });

    res.json({ success: true });

  } catch (error: any) {
    console.error('Failed to save playlist:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to save playlist' });
  }
});

export default router;