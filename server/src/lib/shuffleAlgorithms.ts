// Minimal track shape required by the shuffle algorithms.
// All four fields are the only ones the algorithms actually read or branch on.
// Using a generic <T extends ShuffleTrack> lets callers pass a richer track type
// (e.g. a full Track with audioFeatures) and get that same type back —
// the shuffle functions preserve the concrete type through all permutations.
export interface ShuffleTrack {
  id: string;
  artist: string;
  genres: string[];
  releaseYear: number | null;
}

// Fisher-Yates shuffle — every permutation is equally likely
export const trueRandomShuffle = <T extends ShuffleTrack>(tracks: T[]): T[] => {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Interleaves multiple groups in round-robin order.
// Used by all spread algorithms to evenly distribute tracks across the final list.
const interleaveGroups = <T extends ShuffleTrack>(groups: T[][]): T[] => {
  const filled = groups.map(g => [...g]).filter(g => g.length > 0);
  filled.sort((a, b) => b.length - a.length);

  const result: T[] = [];
  while (filled.some(g => g.length > 0)) {
    for (let i = filled.length - 1; i >= 0; i--) {
      if (filled[i].length > 0) {
        result.push(filled[i].shift()!);
      }
    }
  }
  return result;
};

// Artist Spread — spreads artists evenly across the list so no two consecutive
// tracks share the same artist. Can be applied to any subset of tracks.
export const applyArtistSpread = <T extends ShuffleTrack>(tracks: T[]): T[] => {
  const artistGroups = new Map<string, T[]>();
  tracks.forEach(track => {
    const group = artistGroups.get(track.artist) || [];
    group.push(track);
    artistGroups.set(track.artist, group);
  });

  const groups = [...artistGroups.values()].map(g => trueRandomShuffle(g));
  return interleaveGroups(groups);
};

// Genre Spread — groups by primary genre, then optionally spreads artists within
// each genre group for additional variety.
export const applyGenreSpread = <T extends ShuffleTrack>(tracks: T[], spreadArtists: boolean): T[] => {
  const genreGroups = new Map<string, T[]>();
  tracks.forEach(track => {
    const primaryGenre = track.genres[0] || 'unknown';
    const group = genreGroups.get(primaryGenre) || [];
    group.push(track);
    genreGroups.set(primaryGenre, group);
  });

  const groups = [...genreGroups.values()].map(group =>
    spreadArtists ? applyArtistSpread(group) : trueRandomShuffle(group)
  );
  return interleaveGroups(groups);
};

// Chronological Mix — splits tracks into eras (pre-2000, 2000–2009, 2010+),
// applies further algorithms within each era, then interleaves the eras together.
export const applyChronologicalMix = <T extends ShuffleTrack>(
  tracks: T[],
  spreadGenres: boolean,
  spreadArtists: boolean
): T[] => {
  const old    = tracks.filter(t => (t.releaseYear ?? 2000) < 2000);
  const mid    = tracks.filter(t => { const y = t.releaseYear ?? 2000; return y >= 2000 && y < 2010; });
  const recent = tracks.filter(t => (t.releaseYear ?? 2000) >= 2010);

  const processEra = (era: T[]) => {
    if (era.length === 0) return era;
    if (spreadGenres)  return applyGenreSpread(era, spreadArtists);
    if (spreadArtists) return applyArtistSpread(era);
    return trueRandomShuffle(era);
  };

  return interleaveGroups([recent, mid, old].map(processEra).filter(g => g.length > 0));
};

// Master shuffle function — applies selected algorithms in a fixed order:
// Chronological (outermost) → Genre Spread → Artist Spread → True Random (mutually exclusive)
export const applyShuffle = <T extends ShuffleTrack>(
  tracks: T[],
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }
): T[] => {
  const { trueRandom, artistSpread, genreSpread, chronological } = algorithms;

  if (trueRandom || (!artistSpread && !genreSpread && !chronological)) {
    return trueRandomShuffle(tracks);
  }
  if (chronological) {
    return applyChronologicalMix(tracks, genreSpread, artistSpread);
  }
  if (genreSpread) {
    return applyGenreSpread(tracks, artistSpread);
  }
  return applyArtistSpread(tracks);
};
