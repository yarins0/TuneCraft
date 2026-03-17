import cron from 'node-cron';
import axios from 'axios';
import prisma from '../prisma';
import { applyShuffle } from '../shuffleAlgorithms';
import { getSpotifyAccessToken } from '../auth/spotify';

// Splits an array into chunks of a given size.
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Fetches all tracks for a Spotify playlist, handling pagination automatically.
// Returns a minimal array of track objects — just enough for the shuffle algorithms.
const fetchAllTracks = async (
  spotifyPlaylistId: string,
  accessToken: string
): Promise<{ id: string; artist: string; genres: string[]; releaseYear: number | null }[]> => {
  const tracks: any[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const response = await axios.get(
      `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/items`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      }
    );

    const rawItems = response.data.items || [];
    const items = rawItems.filter((item: any) => {
      const track = item?.item ?? item?.track;
      return track && track.type === 'track';
    });

    tracks.push(
      ...items.map((item: any) => {
        const track = item.item ?? item.track;
        return {
          id: track.id,
          artist: track.artists[0].name,
          genres: [], // genres not needed for cron reshuffle
          releaseYear: track.album.release_date
            ? parseInt(track.album.release_date.substring(0, 4))
            : null,
        };
      })
    );

    // If we've fetched all tracks, stop paginating
    if (offset + limit >= response.data.total) break;
    offset += limit;
  }

  return tracks;
};

// Writes a shuffled track order back to the Spotify playlist.
// Spotify limits PUT to 100 URIs, so large playlists need multiple requests.
const saveShuffledPlaylist = async (
  spotifyPlaylistId: string,
  tracks: { id: string }[],
  accessToken: string
): Promise<void> => {
  const uris = tracks.map(t => `spotify:track:${t.id}`);
  const firstChunk = uris.slice(0, 100);
  const remainingChunks = chunkArray(uris.slice(100), 100);

  await axios.put(
    `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/items`,
    { uris: firstChunk },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  for (const chunk of remainingChunks) {
    await axios.post(
      `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/items`,
      { uris: chunk },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

// Processes a single playlist reshuffle.
// Fetches tracks, applies the stored algorithms, saves back to Spotify, updates the DB record.
const reshufflePlaylist = async (playlist: any): Promise<void> => {
  console.log(`Auto-reshuffling: ${playlist.name} (${playlist.spotifyPlaylistId})`);

  const accessToken = await getSpotifyAccessToken(playlist.userId);
  if (!accessToken) {
    console.error(`No valid token for user ${playlist.userId}, skipping`);
    return;
  }

  try {
    const tracks = await fetchAllTracks(playlist.spotifyPlaylistId, accessToken);

    const algorithms = playlist.algorithms as {
      trueRandom: boolean;
      artistSpread: boolean;
      genreSpread: boolean;
      chronological: boolean;
    };
    const shuffled = applyShuffle(tracks, algorithms);

    await saveShuffledPlaylist(playlist.spotifyPlaylistId, shuffled, accessToken);

    const nextReshuffleAt = new Date();
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + playlist.intervalDays);

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { lastReshuffledAt: new Date(), nextReshuffleAt },
    });

    console.log(`✅ Reshuffled: ${playlist.name}, next at ${nextReshuffleAt.toISOString()}`);

  } catch (error: any) {
    // If Spotify returns 404, the playlist was deleted — clean up the orphaned schedule
    if (error.response?.status === 404) {
      await prisma.playlist.delete({ where: { id: playlist.id } }).catch(() => {});
      console.log(`🗑️ Removed orphaned schedule for deleted playlist: ${playlist.name}`);
      return;
    }
    console.error(`Failed to reshuffle ${playlist.name}:`, error.message);
  }
};

// Fires at minute 0 of every hour.
// Queries only playlists that are due and reshuffles them.
export const startReshuffleCron = (): void => {
  cron.schedule('0 * * * *', async () => {
    console.log('🕐 Reshuffle cron: checking for due playlists...');

    const now = new Date();
    const due = await prisma.playlist.findMany({
      where: { autoReshuffle: true, nextReshuffleAt: { lte: now } },
    });

    if (due.length === 0) {
      console.log('Reshuffle cron: no playlists due.');
      return;
    }

    console.log(`Reshuffle cron: ${due.length} playlist(s) due`);
    for (const playlist of due) {
      await reshufflePlaylist(playlist);
    }
  });
};
