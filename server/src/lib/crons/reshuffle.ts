import cron from 'node-cron';
import type { Playlist } from '@prisma/client';
import prisma from '../prisma';
import { applyShuffle } from '../shuffleAlgorithms';
import { getAdapter, getValidAccessToken } from '../platform/registry';
import type { Platform } from '../platform/types';

// Processes a single playlist reshuffle:
//   1. Gets a valid access token (refreshes if expired)
//   2. Fetches all tracks via the platform adapter (no enrichment — just enough for shuffle)
//   3. Applies the stored shuffle algorithms
//   4. Writes the shuffled order back to the platform
//   5. Updates the DB record with the new lastReshuffledAt and nextReshuffleAt
//
// Returns a status string consumed by the caller to build a summary log line.
const reshufflePlaylist = async (playlist: Playlist): Promise<'shuffled' | 'deleted' | 'skipped'> => {
  const accessToken = await getValidAccessToken(playlist.userId);
  if (!accessToken) return 'skipped';

  try {
    // Resolve the correct adapter for this playlist's platform
    const adapter = getAdapter(playlist.platform as Platform);

    // Fetch all tracks across all pages without audio-feature enrichment
    const tracks = await adapter.fetchAllTracksMeta(accessToken, playlist.platformPlaylistId);

    const algorithms = playlist.algorithms as {
      trueRandom: boolean;
      artistSpread: boolean;
      genreSpread: boolean;
      chronological: boolean;
    };

    const shuffled = applyShuffle(tracks, algorithms);
    const trackIds = shuffled.map(t => t.id);

    // Write the shuffled order back to the platform
    await adapter.replacePlaylistTracks(accessToken, playlist.platformPlaylistId, trackIds);

    // Advance the schedule window
    const nextReshuffleAt = new Date();
    nextReshuffleAt.setDate(nextReshuffleAt.getDate() + (playlist.intervalDays ?? 1));

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { lastReshuffledAt: new Date(), nextReshuffleAt },
    });

    return 'shuffled';
  } catch (error: any) {
    // If the platform returns 404, the playlist was deleted — clean up the orphaned schedule
    if (error.response?.status === 404) {
      await prisma.playlist.delete({ where: { id: playlist.id } }).catch(() => {});
      return 'deleted';
    }
    console.error(`Failed to reshuffle ${playlist.name}:`, error.message);
    return 'skipped';
  }
};

// Fires at minute 0 of every hour.
// Queries only playlists that are due (autoReshuffle=true and nextReshuffleAt <= now)
// and reshuffles them one by one to avoid concurrent writes for the same user.
// Emits a single summary line instead of per-playlist logs.
export const startReshuffleCron = (): void => {
  cron.schedule('0 * * * *', async () => {
    const now = new Date();
    const due = await prisma.playlist.findMany({
      where: { autoReshuffle: true, nextReshuffleAt: { lte: now } },
    });

    if (due.length === 0) return;

    let shuffled = 0;
    let deleted = 0;

    for (const playlist of due) {
      const result = await reshufflePlaylist(playlist);
      if (result === 'shuffled') shuffled++;
      if (result === 'deleted') deleted++;
    }

    console.log(
      `Reshuffle cron: ${shuffled} shuffled, ${deleted} deleted (of ${due.length} due)`
    );
  });
};
