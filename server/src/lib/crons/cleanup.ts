import cron from 'node-cron';
import prisma from '../prisma';
import { getAdapter, getValidAccessToken } from '../platform/registry';
import type { Platform } from '../platform/types';

// Round-robin cursor — tracks which notDue playlist to existence-check next.
// In-memory only; resets to 0 on server restart (harmless).
let cleanupCursor = 0;

// Fires at :05 and :35 past every hour — offset from the reshuffle cron at :00
// so they never overlap. Each run picks ONE not-yet-due playlist and checks
// whether it still exists in the user's library on its platform. If not, the orphaned
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

    const accessToken = await getValidAccessToken(playlist.userId);
    if (!accessToken) return;

    const adapter = getAdapter(playlist.platform as Platform);
    const inLibrary = await adapter.playlistInLibrary(accessToken, playlist.platformPlaylistId);
    if (!inLibrary) {
      await prisma.playlist.delete({ where: { id: playlist.id } }).catch(() => {});
      console.log(`🗑️ Cleanup: removed record for deleted playlist: ${playlist.name}`);
    }
  });
};
