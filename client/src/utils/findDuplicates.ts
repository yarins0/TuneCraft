import type { Track } from '../api/tracks';

// Represents a single duplicate occurrence found in the playlist.
// `index` — the position of this (later) duplicate in the tracks array.
// `originalIndex` — the position of the first (keeper) occurrence.
export interface DuplicateEntry {
  track: Track;
  index: number;        // position of the duplicate (the one to remove)
  originalIndex: number; // position of the first occurrence (the keeper)
}

// Scans a track list and returns all later occurrences of any repeated track.
// The first time a track ID is seen it is registered as the "keeper".
// Every subsequent occurrence of that same ID is flagged as a duplicate.
// Returns an empty array when there are no duplicates.
export const findDuplicates = (tracks: Track[]): DuplicateEntry[] => {
  // Maps a track ID to the index of its first occurrence
  const firstSeen = new Map<string, number>();
  const duplicates: DuplicateEntry[] = [];

  tracks.forEach((track, index) => {
    if (firstSeen.has(track.id)) {
      // This track ID was already seen — it's a duplicate
      duplicates.push({
        track,
        index,
        originalIndex: firstSeen.get(track.id)!,
      });
    } else {
      // First time seeing this ID — register it as the keeper
      firstSeen.set(track.id, index);
    }
  });

  return duplicates;
};