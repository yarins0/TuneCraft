import type { Track } from '../api/tracks';

// The four strategies the user can choose from in the SplitModal
export type SplitStrategy = 'genre' | 'artist' | 'era' | 'mood';

// Represents one output group — a named bucket of tracks that will become its own playlist
export interface SplitGroup {
  name: string;       // The generated playlist name e.g. "Rock", "The Beatles", "90s"
  tracks: Track[];    // The tracks that belong to this group
}

// Converts a release year into a decade label e.g. 1994 → "90s", 2003 → "00s"
const toDecadeLabel = (year: number): string => {
  const decade = Math.floor(year / 10) * 10;
  const suffix = decade >= 2000 ? `${String(decade).slice(2)}s` : `${String(decade).slice(-2)}s`;
  return suffix;
};

// Groups tracks by their first genre tag (from Last.fm)
// Tracks with no genre data are placed into an "Other" bucket
const splitByGenre = (tracks: Track[]): SplitGroup[] => {
  const map = new Map<string, Track[]>();

  tracks.forEach(track => {
    const genre = track.genres[0] ?? 'Other';
    // Capitalise the first letter for cleaner playlist names
    const label = genre.charAt(0).toUpperCase() + genre.slice(1);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(track);
  });

  return Array.from(map.entries())
    .map(([name, tracks]) => ({ name, tracks }))
    // Sort largest groups first so the most useful playlists appear at the top of the preview
    .sort((a, b) => b.tracks.length - a.tracks.length);
};

// Groups tracks by their primary artist name
const splitByArtist = (tracks: Track[]): SplitGroup[] => {
  const map = new Map<string, Track[]>();

  tracks.forEach(track => {
    if (!map.has(track.artist)) map.set(track.artist, []);
    map.get(track.artist)!.push(track);
  });

  return Array.from(map.entries())
    .map(([name, tracks]) => ({ name, tracks }))
    .sort((a, b) => b.tracks.length - a.tracks.length);
};

// Groups tracks by decade using the releaseYear field
// Tracks with no release year go into "Unknown Era"
const splitByEra = (tracks: Track[]): SplitGroup[] => {
  const map = new Map<string, Track[]>();

  tracks.forEach(track => {
    const label = track.releaseYear ? toDecadeLabel(track.releaseYear) : 'Unknown Era';
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(track);
  });

  return Array.from(map.entries())
    .map(([name, tracks]) => ({ name, tracks }))
    // Sort chronologically — "60s" before "70s" etc. Unknown Era goes last
    .sort((a, b) => {
      if (a.name === 'Unknown Era') return 1;
      if (b.name === 'Unknown Era') return -1;
      return parseInt(a.name) - parseInt(b.name);
    });
};

// Groups tracks into "High Energy" and "Low Energy" using the energy audio feature
// The 0.6 threshold splits the 0–1 scale roughly at the upper third
// Tracks with no energy data go into an "Unknown Mood" group
const splitByMood = (tracks: Track[]): SplitGroup[] => {
  const high: Track[] = [];
  const low: Track[] = [];
  const unknown: Track[] = [];

  tracks.forEach(track => {
    const energy = track.audioFeatures.energy;
    if (energy === null) {
      unknown.push(track);
    } else if (energy >= 0.6) {
      high.push(track);
    } else {
      low.push(track);
    }
  });

  const groups: SplitGroup[] = [];
  if (high.length > 0) groups.push({ name: 'High Energy', tracks: high });
  if (low.length > 0) groups.push({ name: 'Low Energy', tracks: low });
  if (unknown.length > 0) groups.push({ name: 'Unknown Mood', tracks: unknown });
  return groups;
};

// Entry point — takes a list of tracks and a strategy, returns the split groups
// Each group will become one new Spotify playlist
export const splitTracks = (tracks: Track[], strategy: SplitStrategy): SplitGroup[] => {
  switch (strategy) {
    case 'genre':  return splitByGenre(tracks);
    case 'artist': return splitByArtist(tracks);
    case 'era':    return splitByEra(tracks);
    case 'mood':   return splitByMood(tracks);
  }
};
