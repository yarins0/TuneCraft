import cron from 'node-cron';
import axios from 'axios';
import prisma from '../prisma';
import { getSpotifyAccessToken } from '../auth/spotify';

// Checks whether a Spotify playlist is still in the user's library by paginating
// GET /me/playlists until the playlist ID is found or all pages are exhausted.
// Returns false only when the full list was fetched and the ID was not present.
// Returns true on any network or API error — never delete on uncertainty.
const playlistInUserLibrary = async (
  spotifyPlaylistId: string,
  accessToken: string
): Promise<boolean> => {
  let offset = 0;
  const limit = 20; // small page size to keep each request light

  try {
    while (true) {
      const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit, offset },
      });

      const items: any[] = response.data.items ?? [];

      // Found — playlist still exists in the user's library
      if (items.some((p: any) => p?.id === spotifyPlaylistId)) return true;

      // No more pages — playlist was not found
      if (offset + limit >= response.data.total) return false;

      offset += limit;
    }
  } catch {
    // Network error, 5xx, etc. — assume it still exists
    return true;
  }
};

// Round-robin cursor — tracks which notDue playlist to existence-check next.
// In-memory only; resets to 0 on server restart (harmless).
let cleanupCursor = 0;

// Fires at :05 and :35 past every hour — offset from the reshuffle cron at :00
// so they never overlap. Each run picks ONE not-yet-due playlist and checks
// whether it still exists in the user's Spotify library. If not, the orphaned
// DB record is deleted. The round-robin cursor cycles through all notDue
// playlists over time, keeping API usage minimal and spread out.
export const startCleanupCron = (): void => {
  cron.schedule('5,35 * * * *', async () => {
    const now = new Date();
    const notDue = await prisma.playlist.findMany({
      where: {
        autoReshuffle: true,
        OR: [{ nextReshuffleAt: null }, { nextReshuffleAt: { gt: now } }],
      },
    });

    if (notDue.length === 0) return;

    // Wrap cursor in case playlists were deleted since the last run
    cleanupCursor = cleanupCursor % notDue.length;
    const playlist = notDue[cleanupCursor];
    cleanupCursor = (cleanupCursor + 1) % notDue.length;

    const accessToken = await getSpotifyAccessToken(playlist.userId);
    if (!accessToken) return;

    const inLibrary = await playlistInUserLibrary(playlist.spotifyPlaylistId, accessToken);
    if (!inLibrary) {
      await prisma.playlist.delete({ where: { id: playlist.id } }).catch(() => {});
      console.log(`🗑️ Cleanup: removed record for deleted playlist: ${playlist.name}`);
    }
  });
};
