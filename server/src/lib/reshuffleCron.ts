import cron from 'node-cron';
import axios from 'axios';
import prisma from './prisma';
import { applyShuffle } from './shuffleAlgorithms';

// Splits an array into chunks of a given size.
const chunkArray = (arr: string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Fetches a valid access token for a user, refreshing it if expired.
const getAccessToken = async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // If the token is still valid, use it directly
  if (user.tokenExpiresAt > new Date()) {
    return user.accessToken;
  }

  // Token is expired — refresh it using the refresh token
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: user.refreshToken,
      }),
      {
        headers: {
          Authorization: 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = response.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Save the new token so future requests use it
    await prisma.user.update({
      where: { id: userId },
      data: { accessToken: access_token, tokenExpiresAt },
    });

    return access_token;
  } catch (error) {
    console.error(`Failed to refresh token for user ${userId}:`, error);
    return null;
  }
};

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

  const accessToken = await getAccessToken(playlist.userId);
  if (!accessToken) {
    console.error(`No valid token for user ${playlist.userId}, skipping`);
    return;
  }

  try {
    // Fetch the current tracks from Spotify
    const tracks = await fetchAllTracks(playlist.spotifyPlaylistId, accessToken);

    // Apply the stored shuffle algorithms
    const algorithms = playlist.algorithms as {
      trueRandom: boolean;
      artistSpread: boolean;
      genreSpread: boolean;
      chronological: boolean;
    };
    const shuffled = applyShuffle(tracks, algorithms);

    // Write the new order back to Spotify
    await saveShuffledPlaylist(playlist.spotifyPlaylistId, shuffled, accessToken);

    // Update the DB record with the new timestamps
    const nextReshuffleAt = new Date();
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + playlist.intervalDays);

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        lastReshuffledAt: new Date(),
        nextReshuffleAt,
      },
    });

    console.log(`✅ Reshuffled: ${playlist.name}, next at ${nextReshuffleAt.toISOString()}`);
  
  } catch (error: any) {
    // If Spotify returns 404, the playlist was deleted — clean up the orphaned schedule
    if (error.response?.status === 404) {
      await prisma.playlist.delete({
        where: { id: playlist.id },
      }).catch(() => {}); // ignore if the DB delete also fails
      console.log(`🗑️ Removed orphaned schedule for deleted playlist: ${playlist.name}`);
      return;
    }
    console.error(`Failed to reshuffle ${playlist.name}:`, error.message);
  }
};

// Starts the cron job. Called once when the server boots.
// Runs every hour and checks for any playlists due for a reshuffle.
export const startReshuffleCron = (): void => {
  // "0 * * * *" means: at minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    console.log('🕐 Cron: checking for playlists due for reshuffle...');

    // Find all active auto-reshuffles where the next reshuffle time has passed
    const due = await prisma.playlist.findMany({
      where: {
        autoReshuffle: true,
        nextReshuffleAt: { lte: new Date() },
      },
    });

    if (due.length === 0) {
      console.log('Cron: nothing due.');
      return;
    }

    console.log(`Cron: ${due.length} playlist(s) due for reshuffle`);

    // Process each due playlist one at a time to avoid rate limiting
    for (const playlist of due) {
      await reshufflePlaylist(playlist);
    }
  });

  console.log('✅ Auto-reshuffle cron job started');
};
