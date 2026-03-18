import { fetchTracksPage } from '../api/tracks';

// Fetches every track from a single playlist by paginating through all pages
// Works for both regular playlists (playlistId) and Liked Songs ('liked')
// Returns a flat array of track objects — same shape as PlaylistDetail uses
const fetchAllTracks = async (userId: string, playlistId: string): Promise<{ id: string }[]> => {
  const tracks: { id: string }[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchTracksPage(userId, playlistId, page);
    tracks.push(...data.tracks.map((t: any) => ({ id: t.id })));
    hasMore = data.hasMore;
    page = data.nextPage;
  }

  return tracks;
};

// Fetches and merges tracks from multiple playlists into a single ordered list
// Playlists are processed in the order they appear in the array — Liked Songs first if present
// Optionally removes duplicate track IDs, keeping only the first occurrence of each
export const buildMergedTrackList = async (
  userId: string,
  // List of playlistIds to merge — may include the sentinel value 'liked' for Liked Songs
  playlistIds: string[],
  removeDuplicates: boolean
): Promise<{ id: string }[]> => {
  // Fetch all tracks from all playlists in parallel for speed
  // Promise.all runs all fetches at the same time rather than waiting for each one to finish
  const results = await Promise.all(
    playlistIds.map(id => fetchAllTracks(userId, id))
  );

  // Flatten the array of arrays into a single list, preserving playlist order
  const allTracks = results.flat();

  if (!removeDuplicates) return allTracks;

  // Deduplication: walk through the list and keep only the first time each track ID is seen
  // A Set is used as a fast lookup to check if we've already included a track
  const seen = new Set<string>();
  return allTracks.filter(track => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
};