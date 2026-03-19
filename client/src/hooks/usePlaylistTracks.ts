import { useEffect, useRef, useState } from 'react';
import { fetchTracksPage, fetchPendingFeatures } from '../api/tracks';
import type { Track, PlaylistAverages } from '../api/tracks';

const getUserId = () => localStorage.getItem('userId') || '';

// Recalculates playlist averages from the full set of loaded tracks.
// Called after each page loads and after feature polling updates arrive,
// so the charts stay up to date as tracks stream in.
const recalculateAverages = (tracks: Track[]): PlaylistAverages => {
  const avg = (key: keyof PlaylistAverages) => {
    const values = tracks
      .map(t => t.audioFeatures[key])
      .filter(v => v !== null) as number[];
    return values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      : null;
  };

  const tempos = tracks
    .map(t => t.audioFeatures.tempo)
    .filter(v => v !== null) as number[];

  return {
    energy: avg('energy'),
    danceability: avg('danceability'),
    valence: avg('valence'),
    acousticness: avg('acousticness'),
    instrumentalness: avg('instrumentalness'),
    speechiness: avg('speechiness'),
    tempo: tempos.length
      ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
      : null,
  };
};

export interface UsePlaylistTracksResult {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  averages: PlaylistAverages | null;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

// Manages all track loading state for a playlist page:
//   - Streams pages progressively so the first 50 tracks appear immediately
//   - Polls the /features endpoint for background-enriched audio features
//   - Keeps averages in sync as pages and feature updates arrive
//   - Cleans up polling and in-flight requests when playlistId changes
//
// onReset is called at the start of each new playlist load so the parent can
// reset its own UI state (unsaved changes, open rows, expanded duplicates, etc.).
// It's stored in a ref so it never needs to be listed as a dependency — we always
// call the latest version without re-running the effect on every render.
export const usePlaylistTracks = (
  playlistId: string | undefined,
  onReset: () => void
): UsePlaylistTracksResult => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [averages, setAverages] = useState<PlaylistAverages | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Holds the latest onReset without making it an effect dependency
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  const pendingFeatureIds = useRef<Set<string>>(new Set());
  const featurePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keeps averages in sync with the full track list.
  // Using a derived-state effect rather than calling setAverages inside setTracks updaters,
  // which is a React anti-pattern — state setters should not be called inside other state updater functions.
  // This effect runs after: initial load, background page loads, and feature polling updates.
  useEffect(() => {
    if (tracks.length === 0) return;
    setAverages(recalculateAverages(tracks));
  }, [tracks]);

  useEffect(() => {
    if (!playlistId) return;

    // Reset all hook state and notify the parent to reset its own UI state
    setTracks([]);
    setAverages(null);
    setLoading(true);
    setLoadingMore(false);
    onResetRef.current();

    let cancelled = false;

    // Clears the pending set and stops the polling interval
    const stopPolling = () => {
      if (featurePollingRef.current) {
        clearInterval(featurePollingRef.current);
        featurePollingRef.current = null;
      }
      pendingFeatureIds.current.clear();
    };

    // Adds null-feature tracks to the pending set and starts polling if not already running.
    // The poll hits the lightweight /features endpoint (DB cache only) every second.
    // When features arrive they're merged into track state and averages are recalculated.
    const scheduleFeaturePolling = (newTracks: Track[]) => {
      const missing = newTracks.filter(t =>
        Object.values(t.audioFeatures).every(v => v === null)
      );
      if (missing.length === 0) return;

      missing.forEach(t => pendingFeatureIds.current.add(t.id));

      if (featurePollingRef.current) return; // interval already running

      featurePollingRef.current = setInterval(async () => {
        const pending = Array.from(pendingFeatureIds.current);
        if (pending.length === 0) {
          clearInterval(featurePollingRef.current!);
          featurePollingRef.current = null;
          return;
        }

        try {
          const { features } = await fetchPendingFeatures(getUserId(), pending);
          const arrived = Object.entries(features).filter(
            ([, f]) => f && Object.values(f).some(v => v !== null)
          );
          if (arrived.length === 0) return;

          arrived.forEach(([id]) => pendingFeatureIds.current.delete(id));
          const featureMap = Object.fromEntries(arrived);

          setTracks(prev =>
            prev.map(t =>
              featureMap[t.id] ? { ...t, audioFeatures: featureMap[t.id] } : t
            )
          );
        } catch {
          // Polling errors are silent — will retry on the next interval tick
        }
      }, 1000);
    };

    // Loads all remaining pages after the first page has already been shown.
    // Runs in the background so the user isn't blocked waiting for large playlists.
    // The setTimeout(0) between pages yields to the JS message queue so React can flush
    // each setTracks update into a visible render before fetching the next page.
    // Without it, React 18's automatic batching collapses all setTracks calls into one
    // update at the end when the server responds quickly (e.g. localhost).
    const loadAllPages = async (startPage: number) => {
      let currentPage = startPage;
      let more = true;
      setLoadingMore(true);

      while (more && !cancelled) {
        try {
          const data = await fetchTracksPage(getUserId(), playlistId, currentPage);
          if (cancelled) break;

          setTracks(prev => [...prev, ...data.tracks]);
          scheduleFeaturePolling(data.tracks);

          more = data.hasMore;
          currentPage = data.nextPage;

          // Yield to the event loop so React renders this page before fetching the next one
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch {
          console.error(`Failed to load page ${currentPage}`);
          break;
        }
      }

      if (!cancelled) setLoadingMore(false);
    };

    // Load the first page immediately, then kick off background loading for the rest
    fetchTracksPage(getUserId(), playlistId, 0)
      .then(data => {
        if (cancelled) return;
        setTracks(data.tracks);
        setAverages(data.playlistAverages);
        setTotal(data.total);
        setLoading(false);
        scheduleFeaturePolling(data.tracks);

        if (data.hasMore) loadAllPages(data.nextPage);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Failed to load tracks');
        setLoading(false);
      });

    // If playlistId changes before loading finishes, cancel in-flight requests and stop polling
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [playlistId]);

  return { tracks, setTracks, averages, total, loading, loadingMore, error };
};
