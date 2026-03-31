// Shared utilities used by multiple playlist controller modules.

// Minimum track shape required for average calculation.
interface TrackWithFeatures {
  audioFeatures: Record<string, number | null>;
}

// Calculates the average value of each audio feature across all tracks in a page.
// Used to attach playlist-level stats to every tracks response.
export const calculateAverages = (tracks: TrackWithFeatures[]) => {
  const average = (key: string) => {
    const values = tracks
      .map(t => t.audioFeatures[key])
      .filter((v): v is number => v !== null);
    return values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      : null;
  };

  return {
    energy:           average('energy'),
    danceability:     average('danceability'),
    valence:          average('valence'),
    acousticness:     average('acousticness'),
    instrumentalness: average('instrumentalness'),
    speechiness:      average('speechiness'),
    tempo: Math.round(
      tracks.reduce((sum, t) => sum + (t.audioFeatures.tempo ?? 0), 0) / tracks.length
    ),
  };
};

// A serial write queue keyed by userId.
// Platform rate limits apply per OAuth token — each user has their own rolling window.
// Serializing per user prevents a single user's concurrent requests from colliding
// without blocking writes for other users.
const writeQueues = new Map<string, Promise<void>>();

export const enqueueWrite = <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
  const current = writeQueues.get(userId) ?? Promise.resolve();
  const result  = current.then(fn);
  // After settling (success or error), remove the entry so the Map doesn't grow indefinitely.
  // Uses reference identity of `tail` to avoid deleting a newer entry that replaced this one.
  const tail = result.finally(() => {
    if (writeQueues.get(userId) === tail) writeQueues.delete(userId);
  }) as Promise<void>;
  writeQueues.set(userId, tail);
  return result;
};
