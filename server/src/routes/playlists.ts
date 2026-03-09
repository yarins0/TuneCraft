import { Router } from 'express';
import axios from 'axios';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import prisma from '../lib/prisma';

const router = Router();

// Splits an array into chunks of a given size
// Used to batch API requests and avoid rate limiting
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

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

  // Step 1 — Check which tracks are already cached in the database
  const cached = await prisma.trackCache.findMany({
    where: { spotifyId: { in: trackIds } },
  });

  const cachedMap: Record<string, any> = {};
  cached.forEach(entry => {
    cachedMap[entry.spotifyId] = entry;
  });

  // Step 2 — Find which tracks are NOT in the cache
  const missedTracks = tracks.filter(t => !cachedMap[t.id]);
  const missedTrackIds = missedTracks.map(t => t.id);

  const audioFeaturesMap: Record<string, any> = {};
  const artistGenreMap: Record<string, string[]> = {};

  // Step 3 — Populate maps from cache for tracks we already have
  cached.forEach(entry => {
    audioFeaturesMap[entry.spotifyId] = entry.audioFeatures;
    // genres are stored per-track in cache, keyed by spotifyId temporarily
    // we'll resolve to artistId below
  });

  // Step 4 — Fetch external data only for cache misses
  if (missedTrackIds.length > 0) {
    const chunks = chunkArray(missedTrackIds, 50);

    const batchResults = await Promise.all(
      chunks.map((chunk: string[]) =>
        axios.get('https://api.reccobeats.com/v1/track', {
          params: { ids: chunk.join(',') },
        })
        .then(r => r.data.content || [])
        .catch(() => [])
      )
    );

    // Map Spotify IDs to ReccoBeats UUIDs
    const reccoBeatsIdMap: Record<string, string> = {};
    batchResults.flat().forEach((feature: any) => {
      if (feature?.href && feature?.id) {
        const spotifyId = feature.href.split('/').pop();
        reccoBeatsIdMap[spotifyId] = feature.id;
      }
    });

    // Fetch audio features for cache misses
    await Promise.all(
      Object.entries(reccoBeatsIdMap).map(([spotifyId, reccoId]) =>
        axios.get(`https://api.reccobeats.com/v1/track/${reccoId}/audio-features`)
          .then(r => { audioFeaturesMap[spotifyId] = r.data; })
          .catch(() => {})
      )
    );

    // Fetch genres for unique artists of cache misses only
    const uniqueMissedArtists = [
      ...new Map(
        missedTracks.map(t => [t.artistId, { id: t.artistId, name: t.artistName }])
      ).values()
    ];

    const genreResults = await Promise.all(
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
          genres: (r.data.toptags?.tag || [])
            .slice(0, 3)
            .map((tag: any) => tag.name.toLowerCase()),
        }))
        .catch(() => ({ id, genres: [] as string[] }))
      )
    );

    const missedArtistGenreMap: Record<string, string[]> = {};
    genreResults.forEach(({ id, genres }) => {
      missedArtistGenreMap[id] = genres;
    });

    // Step 5 — Save all cache misses to the database in one batch
    await Promise.all(
      missedTracks.map(track =>
        prisma.trackCache.upsert({
          where: { spotifyId: track.id },
          update: {
            audioFeatures: audioFeaturesMap[track.id] || {},
            genres: missedArtistGenreMap[track.artistId] || [],
            cachedAt: new Date(),
          },
          create: {
            spotifyId: track.id,
            audioFeatures: audioFeaturesMap[track.id] || {},
            genres: missedArtistGenreMap[track.artistId] || [],
          },
        }).catch(() => {})
      )
    );

    // Merge missed artist genres into the main genre map
    Object.assign(artistGenreMap, missedArtistGenreMap);
  }

  // Step 6 — Build the final artistGenreMap from all sources
  // For cached tracks, retrieve their genres and map back to artistId
  cached.forEach(entry => {
    const track = tracks.find(t => t.id === entry.spotifyId);
    if (track) {
      artistGenreMap[track.artistId] = entry.genres as string[];
    }
  });

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

  return {
    id: rawTrack.id,
    name: rawTrack.name,
    artist: rawTrack.artists[0].name,
    albumName: rawTrack.album.name,
    albumImageUrl: rawTrack.album.images[0]?.url ?? null,
    durationMs: rawTrack.duration_ms,
    // Extract the decade from the release date (e.g. "2019-05-01" → 2010s)
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

// Calculates the average value of an audio feature across all tracks
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

    const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 50 },
    });

    const playlists = response.data.items
      .filter((playlist: any) => playlist !== null)
      .map((playlist: any) => ({
        spotifyId: playlist.id,
        name: playlist.name,
        trackCount: playlist.tracks?.total ?? 0,
        imageUrl: playlist.images?.[0]?.url ?? null,
        ownerId: playlist.owner.id,
      }));

    res.json({ playlists });

  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// GET /playlists/:userId/liked
// Fetches the Liked Songs count for the dashboard card
// Liked Songs are not included in /me/playlists so they require a separate call
router.get('/:userId/liked', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;

  try {
    const response = await axios.get('https://api.spotify.com/v1/me/tracks', {
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
// Streams tracks from the user's Liked Songs page by page
// Uses SSE to send tracks to the frontend as each page loads
router.get('/:userId/liked/tracks', refreshTokenMiddleware, async (req, res) => {
  const accessToken = (req as any).accessToken;
  const page = parseInt(req.query.page as string) || 0;
  const limit = 50;
  const offset = page * limit;

  try {
    const tracksResponse = await axios.get('https://api.spotify.com/v1/me/tracks', {
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
    const tracksResponse = await axios.get(
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
    res.status(500).json({ error: 'Failed to fetch playlist tracks' });
  }
});

export default router;