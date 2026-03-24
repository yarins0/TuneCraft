import { useEffect, useRef, useState } from 'react';
import { fetchTracksPage, fetchPendingFeatures, fetchPendingGenres } from '../api/tracks';
import type { Track, PlaylistAverages } from '../api/tracks';
import { getActiveAccount } from '../utils/accounts';

const getUserId = () => getActiveAccount()?.userId || '';

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

  // Mirrors the feature polling pattern but for genre tags.
  // Keys are lowercased+trimmed artist names — matching the server's normalizedName column.
  const pendingGenreArtists = useRef<Set<string>>(new Set());
  const genrePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // AbortController lets us cancel in-flight fetch() calls at the network level.
    // When abort() is called, any pending fetchTracksPage() promises will reject
    // with a DOMException whose name is 'AbortError'. This is different from the
    // `cancelled` flag, which only prevents state updates — the fetch itself would
    // otherwise keep running and consuming bandwidth/server resources.
    const controller = new AbortController();
    const { signal } = controller;

    // Clears all pending sets and stops both polling intervals
    const stopPolling = () => {
      if (featurePollingRef.current) {
        clearInterval(featurePollingRef.current);
        featurePollingRef.current = null;
      }
      pendingFeatureIds.current.clear();

      if (genrePollingRef.current) {
        clearInterval(genrePollingRef.current);
        genrePollingRef.current = null;
      }
      pendingGenreArtists.current.clear();
    };

    // Adds null-feature tracks to the pending set and starts polling if not already running.
    // The poll hits the lightweight /features endpoint (DB cache only) every second.
    // When features arrive they're merged into track state and averages are recalculated.
    //
    // Polling stops automatically when either:
    //   a) all pending IDs resolve (normal completion), or
    //   b) 30 consecutive polls return nothing new (enrichment finished with no data for those tracks).
    // The consecutive-miss counter resets whenever any feature arrives, so mixed playlists
    // (some tracks enrichable, some not) still wait long enough for the resolvable ones.
    const MAX_EMPTY_POLLS = 30;

    const scheduleFeaturePolling = (newTracks: Track[]) => {
      const missing = newTracks.filter(t =>
        Object.values(t.audioFeatures).every(v => v === null)
      );
      if (missing.length === 0) return;

      missing.forEach(t => pendingFeatureIds.current.add(t.id));

      if (featurePollingRef.current) return; // interval already running

      let consecutiveEmptyPolls = 0;

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

          if (arrived.length === 0) {
            consecutiveEmptyPolls++;
            // Give up on remaining IDs after 30s of no progress — the background
            // enrichment has finished and these tracks simply have no audio features
            // (ReccoBeats doesn't cover them, or no Spotify ID could be resolved).
            if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
              clearInterval(featurePollingRef.current!);
              featurePollingRef.current = null;
              pendingFeatureIds.current.clear();
            }
            return;
          }

          // New features arrived — reset the timeout and apply the updates
          consecutiveEmptyPolls = 0;
          arrived.forEach(([id]) => pendingFeatureIds.current.delete(id));
          const featureMap = Object.fromEntries(arrived);

          setTracks(prev =>
            prev.map(t =>
              featureMap[t.id] ? { ...t, audioFeatures: featureMap[t.id] } : t
            )
          );
        } catch {
          // Network errors are silent — will retry on the next interval tick.
          // Importantly, errors do NOT increment the empty-poll counter so a brief
          // network hiccup doesn't cause premature polling shutdown.
        }
      }, 1000);
    };

    // Adds tracks with empty genres to the pending set and starts polling if not already running.
    // Polls the /genres endpoint every 2 seconds (genres resolve slower than features —
    // Last.fm is queried after ReccoBeats, and only once per artist across all tracks).
    // Stops after MAX_EMPTY_POLLS consecutive polls with no new genres.
    const scheduleGenrePolling = (newTracks: Track[]) => {
      const missing = newTracks.filter(t => t.genres.length === 0);
      if (missing.length === 0) return;

      // Key by normalized artist name — matches the server's normalizedName column
      missing.forEach(t => pendingGenreArtists.current.add(t.artist.toLowerCase().trim()));

      if (genrePollingRef.current) return; // interval already running

      let consecutiveEmptyPolls = 0;

      genrePollingRef.current = setInterval(async () => {
        const pending = Array.from(pendingGenreArtists.current);
        if (pending.length === 0) {
          clearInterval(genrePollingRef.current!);
          genrePollingRef.current = null;
          return;
        }

        try {
          const { genres } = await fetchPendingGenres(getUserId(), pending);
          const arrived = Object.entries(genres).filter(([, g]) => g.length > 0);

          if (arrived.length === 0) {
            consecutiveEmptyPolls++;
            if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
              clearInterval(genrePollingRef.current!);
              genrePollingRef.current = null;
              pendingGenreArtists.current.clear();
            }
            return;
          }

          // New genres arrived — reset the timeout and apply updates to all matching tracks.
          // A single artist entry covers every track by that artist in the playlist.
          consecutiveEmptyPolls = 0;
          const genreMap = Object.fromEntries(arrived);
          arrived.forEach(([name]) => pendingGenreArtists.current.delete(name));

          setTracks(prev =>
            prev.map(t => {
              const key = t.artist.toLowerCase().trim();
              return genreMap[key] ? { ...t, genres: genreMap[key] } : t;
            })
          );
        } catch {
          // Silent on network errors — will retry on the next tick
        }
      }, 2000);
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
          // Pass the AbortSignal so navigation drops the network request immediately.
          const data = await fetchTracksPage(getUserId(), playlistId, currentPage, signal);
          if (cancelled) break;

          setTracks(prev => [...prev, ...data.tracks]);
          // Keep the displayed total in sync as each page reveals more of the true count.
          // Tidal doesn't always return meta.total, so the server derives an estimate from the
          // cursor — updating here means the "X out of Y" counter grows page by page instead
          // of staying frozen at the first-page estimate.
          setTotal(data.total);
          scheduleFeaturePolling(data.tracks);
          scheduleGenrePolling(data.tracks);

          more = data.hasMore;
          currentPage = data.nextPage;

          // Yield to the event loop so React renders this page before fetching the next one
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (err) {
          // An AbortError means the user navigated away and we intentionally cancelled
          // the request — this is not a real error and should not be logged or shown.
          if (err instanceof DOMException && err.name === 'AbortError') break;
          console.error(`Failed to load page ${currentPage}`);
          break;
        }
      }

      if (!cancelled) setLoadingMore(false);
    };

    // Load the first page immediately, then kick off background loading for the rest.
    // The AbortSignal is passed so navigating away drops the network request, not just
    // the state update.
    fetchTracksPage(getUserId(), playlistId, 0, signal)
      .then(data => {
        if (cancelled) return;
        setTracks(data.tracks);
        setAverages(data.playlistAverages);
        setTotal(data.total);
        setLoading(false);
        scheduleFeaturePolling(data.tracks);
        scheduleGenrePolling(data.tracks);

        if (data.hasMore) loadAllPages(data.nextPage);
      })
      .catch(err => {
        // AbortError: the user navigated away — not a real error, do not surface it.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (cancelled) return;
        setError(err.message || 'Failed to load tracks');
        setLoading(false);
      });

    // If playlistId changes (or the component unmounts) before loading finishes,
    // abort all in-flight fetch() calls at the network level and stop polling.
    // The `cancelled` flag then prevents any stale state updates that may still
    // land between abort() and the AbortError being thrown.
    return () => {
      cancelled = true;
      controller.abort();
      stopPolling();
    };
  }, [playlistId]);

  return { tracks, setTracks, averages, total, loading, loadingMore, error };
};
