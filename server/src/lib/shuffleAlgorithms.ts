interface Track {
  id: string;
  artist: string;
  genres: string[];
  releaseYear: number | null;
}

// Fisher-Yates shuffle — every permutation is equally likely
export const trueRandomShuffle = (tracks: Track[]): Track[] => {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Interleaves multiple groups in round-robin order
// Used by all spread algorithms to evenly distribute tracks
const interleaveGroups = (groups: Track[][]): Track[] => {
  const filled = groups.map(g => [...g]).filter(g => g.length > 0);
  filled.sort((a, b) => b.length - a.length);

  const result: Track[] = [];
  while (filled.some(g => g.length > 0)) {
    for (let i = filled.length - 1; i >= 0; i--) {
      if (filled[i].length > 0) {
        result.push(filled[i].shift()!);
      }
    }
  }
  return result;
};

// Artist Spread — spreads artists evenly across a list of tracks
// Can be applied to any subset of tracks (used as a building block)
export const applyArtistSpread = (tracks: Track[]): Track[] => {
  const artistGroups = new Map<string, Track[]>();
  tracks.forEach(track => {
    const group = artistGroups.get(track.artist) || [];
    group.push(track);
    artistGroups.set(track.artist, group);
  });

  const groups = [...artistGroups.values()].map(g => trueRandomShuffle(g));
  return interleaveGroups(groups);
};

// Genre Spread — groups by genre, optionally spreading artists within each group
export const applyGenreSpread = (tracks: Track[], spreadArtists: boolean): Track[] => {
  const genreGroups = new Map<string, Track[]>();
  tracks.forEach(track => {
    const primaryGenre = track.genres[0] || 'unknown';
    const group = genreGroups.get(primaryGenre) || [];
    group.push(track);
    genreGroups.set(primaryGenre, group);
  });

  // Apply artist spread within each genre group if requested
  const groups = [...genreGroups.values()].map(group =>
    spreadArtists ? applyArtistSpread(group) : trueRandomShuffle(group)
  );

  return interleaveGroups(groups);
};

// Chronological Mix — splits into eras, then applies further algorithms within each era
export const applyChronologicalMix = (
  tracks: Track[],
  spreadGenres: boolean,
  spreadArtists: boolean
): Track[] => {
  const old    = tracks.filter(t => (t.releaseYear ?? 2000) < 2000);
  const mid    = tracks.filter(t => { const y = t.releaseYear ?? 2000; return y >= 2000 && y < 2010; });
  const recent = tracks.filter(t => (t.releaseYear ?? 2000) >= 2010);

  // Apply genre/artist spread within each era if requested
  const processEra = (era: Track[]) => {
    if (era.length === 0) return era;
    if (spreadGenres) return applyGenreSpread(era, spreadArtists);
    if (spreadArtists) return applyArtistSpread(era);
    return trueRandomShuffle(era);
  };

  const groups = [recent, mid, old]
    .map(processEra)
    .filter(g => g.length > 0);

  return interleaveGroups(groups);
};

// Master shuffle function — applies selected algorithms in the correct order
// Order: Chronological → Genre Spread → Artist Spread
export const applyShuffle = (
  tracks: Track[],
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }
): Track[] => {
  const { trueRandom, artistSpread, genreSpread, chronological } = algorithms;

  // If nothing selected or only true random, do a simple shuffle
  if (trueRandom || (!artistSpread && !genreSpread && !chronological)) {
    return trueRandomShuffle(tracks);
  }

  // Chronological is the outermost layer — it splits into eras first
  if (chronological) {
    return applyChronologicalMix(tracks, genreSpread, artistSpread);
  }

  // Genre spread is the middle layer
  if (genreSpread) {
    return applyGenreSpread(tracks, artistSpread);
  }

  // Artist spread alone
  return applyArtistSpread(tracks);
};