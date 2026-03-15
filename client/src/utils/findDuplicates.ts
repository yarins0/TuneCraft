import type { Track } from '../api/tracks';

// Represents a single duplicate occurrence found in a playlist.
// `index` is the position of this later copy in the tracks array.
// `originalIndex` is the position of the first (keeper) occurrence.
export interface DuplicateEntry {
  track: Track;
  index: number;
  originalIndex: number;
}

// Scans a track list and returns every occurrence after the first for any repeated track ID.
// The first time a track ID appears it is registered as the keeper and skipped.
// Every subsequent occurrence of the same ID is collected as a duplicate.
// Returns an empty array when the playlist has no duplicates.
export const findDuplicates = (tracks: Track[]): DuplicateEntry[] => {
  const firstSeen = new Map<string, number>(); // track ID → index of first occurrence
  const duplicates: DuplicateEntry[] = [];

  tracks.forEach((track, index) => {
    if (firstSeen.has(track.id)) {
      duplicates.push({ track, index, originalIndex: firstSeen.get(track.id)! });
    } else {
      firstSeen.set(track.id, index);
    }
  });

  return duplicates;
};