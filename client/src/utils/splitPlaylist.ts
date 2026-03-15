import type { Track, AudioFeatures } from '../api/tracks';

// The strategies the user can choose from in the SplitModal
export type SplitStrategy =
  | 'genre'
  | 'artist'
  | 'era'
  | 'energy'
  | 'danceability'
  | 'valence'
  | 'acousticness'
  | 'instrumentalness'
  | 'speechiness'
  | 'tempo';

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

// Groups tracks by genre tag (from Last.fm).
// A track is added to EVERY bucket matching one of its genre tags, not just the first.
// This means a track tagged ["rock", "classic rock"] will appear in both the Rock
// and Classic Rock splits — reflecting how genre-tagged music actually works.
// Tracks with no genre data at all are placed into an "Other" bucket.
const splitByGenre = (tracks: Track[]): SplitGroup[] => {
  const map = new Map<string, Track[]>();

  tracks.forEach(track => {
    // If the track has no genres, put it in Other and move on
    if (track.genres.length === 0) {
      if (!map.has('Other')) map.set('Other', []);
      map.get('Other')!.push(track);
      return;
    }

    // Add the track to every genre bucket it belongs to
    track.genres.forEach(genre => {
      // Capitalise the first letter for cleaner playlist names e.g. "rock" → "Rock"
      const label = genre.charAt(0).toUpperCase() + genre.slice(1);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(track);
    });
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

type AudioFeatureKey = keyof AudioFeatures;

const AUDIO_FEATURE_DISPLAY_NAME: Record<AudioFeatureKey, string> = {
  energy: 'Energy',
  danceability: 'Danceability',
  valence: 'Valence',
  acousticness: 'Acousticness',
  instrumentalness: 'Instrumentalness',
  speechiness: 'Speechiness',
  tempo: 'Tempo',
};

interface BucketDefinition {
  name: string;
  matches: (value: number) => boolean;
}

const threeLevelBuckets = (lowLabel: string, midLabel: string, highLabel: string): BucketDefinition[] => [
  { name: lowLabel, matches: v => v < 0.33 },
  { name: midLabel, matches: v => v >= 0.33 && v < 0.66 },
  { name: highLabel, matches: v => v >= 0.66 },
];

const AUDIO_FEATURE_BUCKETS: Record<AudioFeatureKey, BucketDefinition[]> = {
  energy: threeLevelBuckets('Low Energy', 'Medium Energy', 'High Energy'),
  danceability: threeLevelBuckets('Low Danceability', 'Medium Danceability', 'High Danceability'),
  valence: threeLevelBuckets('Low Valence', 'Medium Valence', 'High Valence'),
  acousticness: threeLevelBuckets('Low Acousticness', 'Medium Acousticness', 'High Acousticness'),
  instrumentalness: threeLevelBuckets('Low Instrumentalness', 'Medium Instrumentalness', 'High Instrumentalness'),
  speechiness: threeLevelBuckets('Low Speechiness', 'Medium Speechiness', 'High Speechiness'),
  tempo: [
    { name: 'Chill (< 90 BPM)', matches: v => v < 90 },
    { name: 'Groove (90–120 BPM)', matches: v => v >= 90 && v < 120 },
    { name: 'Upbeat (120–140 BPM)', matches: v => v >= 120 && v < 140 },
    { name: 'High Tempo (≥ 140 BPM)', matches: v => v >= 140 },
  ],
};

const splitByAudioFeature = (tracks: Track[], feature: AudioFeatureKey): SplitGroup[] => {
  const buckets = AUDIO_FEATURE_BUCKETS[feature];
  const groupsMap = new Map<string, Track[]>();
  const unknown: Track[] = [];

  tracks.forEach(track => {
    const value = track.audioFeatures[feature];
    if (value === null) {
      unknown.push(track);
      return;
    }

    const bucket = buckets.find(b => b.matches(value));
    const bucketName = bucket?.name ?? 'Other';
    if (!groupsMap.has(bucketName)) groupsMap.set(bucketName, []);
    groupsMap.get(bucketName)!.push(track);
  });

  const displayName = AUDIO_FEATURE_DISPLAY_NAME[feature];

  const groups: SplitGroup[] = Array.from(groupsMap.entries())
    .map(([name, tracks]) => ({ name, tracks }))
    .sort((a, b) => b.tracks.length - a.tracks.length);

  if (unknown.length > 0) {
    groups.push({
      name: `Unknown ${displayName}`,
      tracks: unknown,
    });
  }

  return groups;
};

// Entry point — takes a list of tracks and a strategy, returns the split groups
// Each group will become one new Spotify playlist
export const splitTracks = (tracks: Track[], strategy: SplitStrategy): SplitGroup[] => {
  switch (strategy) {
    case 'genre':
      return splitByGenre(tracks);
    case 'artist':
      return splitByArtist(tracks);
    case 'era':
      return splitByEra(tracks);
    case 'energy':
      return splitByAudioFeature(tracks, 'energy');
    case 'danceability':
      return splitByAudioFeature(tracks, 'danceability');
    case 'valence':
      return splitByAudioFeature(tracks, 'valence');
    case 'acousticness':
      return splitByAudioFeature(tracks, 'acousticness');
    case 'instrumentalness':
      return splitByAudioFeature(tracks, 'instrumentalness');
    case 'speechiness':
      return splitByAudioFeature(tracks, 'speechiness');
    case 'tempo':
      return splitByAudioFeature(tracks, 'tempo');
  }
};