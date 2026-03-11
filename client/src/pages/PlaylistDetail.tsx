import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchTracksPage } from '../api/tracks';
import type { Track, PlaylistAverages } from '../api/tracks';
import { formatDuration } from '../api/tracks';
import AudioFeatureChart from '../components/AudioFeatureChart';
import { AUDIO_FEATURES } from '../constants/audioFeatures';
import PlaylistCompositionCharts from '../components/PlaylistCompositionCharts';
import ShuffleModal from '../components/ShuffleModal';
import CopyModal from '../components/CopyModal';
import TrackAudioFeaturesCollapse from '../components/TrackAudioFeaturesCollapse';
import { copyPlaylist, savePlaylist } from '../api/playlists';
import { applyShuffle } from '../utils/shuffleAlgorithms';
import { enableReshuffle, disableReshuffle, fetchReshuffleSchedule } from '../api/reshuffle';
import type { ReshuffleSchedule } from '../api/reshuffle';

const getUserId = () => sessionStorage.getItem('userId') || '';
const getSpotifyId = () => sessionStorage.getItem('spotifyId') || '';

// Recalculates playlist averages from the full set of loaded tracks
// Called after each page loads so the charts stay up to date as tracks stream in
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

export default function PlaylistDetail() {
  const { spotifyId } = useParams<{ spotifyId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // location.state is set when navigating within the app via React Router
  // searchParams is the fallback for when the page is opened in a new tab (e.g. after copy)
  // — new tabs don't carry React Router state, so we encode the info in the URL instead
  const searchParams = new URLSearchParams(location.search);
  const state = (location.state || {}) as { ownerId?: string; name?: string };
  const ownerId = state.ownerId || searchParams.get('ownerId') || undefined;
  const name = state.name || searchParams.get('name') || undefined;

  const isOwner = ownerId === getSpotifyId();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [averages, setAverages] = useState<PlaylistAverages | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [openTrackIds, setOpenTrackIds] = useState<Set<string>>(() => new Set());

  const [shuffleModalOpen, setShuffleModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalTracks, setOriginalTracks] = useState<Track[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dragFromIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-reshuffle panel state
  // reshuffleSchedule — the schedule currently saved in the DB (null if none exists)
  // reshuffleOpen — whether the panel is expanded
  // reshuffleInterval — the number of days between reshuffles (controlled input)
  // reshuffleAlgorithms — which shuffle algorithms are selected in the panel
  // reshuffleLoading — true while a save/delete API call is in flight
  const [reshuffleSchedule, setReshuffleSchedule] = useState<ReshuffleSchedule | null>(null);
  const [reshuffleOpen, setReshuffleOpen] = useState(false);
  const [reshuffleInterval, setReshuffleInterval] = useState(7);
  const [reshuffleAlgorithms, setReshuffleAlgorithms] = useState({
    trueRandom: false,
    artistSpread: true,
    genreSpread: false,
    chronological: false,
  });
  const [reshuffleLoading, setReshuffleLoading] = useState(false);

  useEffect(() => {
    if (!spotifyId) return;

    // Reset state when playlist changes
    setTracks([]);
    setAverages(null);
    setLoading(true);
    setLoadingMore(false);
    setHasUnsavedChanges(false);
    setOriginalTracks([]);
    setOpenTrackIds(new Set());

    let cancelled = false;

    // Loads all remaining pages after the first page has already been shown
    // Runs in the background so the user isn't blocked waiting for large playlists
    const loadAllPages = async (startPage: number) => {
      let currentPage = startPage;
      let more = true;
      setLoadingMore(true);

      while (more && !cancelled) {
        try {
          const data = await fetchTracksPage(getUserId(), spotifyId, currentPage);
          if (cancelled) break;

          setTracks(prev => {
            const updated = [...prev, ...data.tracks];
            setAverages(recalculateAverages(updated));
            return updated;
          });

          more = data.hasMore;
          currentPage = data.nextPage;
        } catch {
          console.error(`Failed to load page ${currentPage}`);
          break;
        }
      }

      if (!cancelled) setLoadingMore(false);
    };

    // Load the first page immediately, then kick off background loading for the rest
    fetchTracksPage(getUserId(), spotifyId, 0)
      .then(data => {
        if (cancelled) return;
        setTracks(data.tracks);
        setAverages(data.playlistAverages);
        setTotal(data.total);
        setLoading(false);

        if (data.hasMore) loadAllPages(data.nextPage);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Failed to load tracks');
        setLoading(false);
      });

    // If spotifyId changes before loading finishes, cancel the in-flight requests
    return () => { cancelled = true; };
  }, [spotifyId]);

  // Fetches the existing auto-reshuffle schedule for this playlist when the page loads
  // If one exists, pre-fills the panel inputs so the user can see/edit their current settings
  useEffect(() => {
    if (!spotifyId || spotifyId === 'liked' || !isOwner) return;

    fetchReshuffleSchedule(getUserId(), spotifyId)
      .then(schedule => {
        setReshuffleSchedule(schedule);
        // Pre-fill the inputs from the saved schedule so the user sees their current settings
        if (schedule) {
          setReshuffleInterval(schedule.intervalDays ?? 7);
          if (schedule.algorithms) setReshuffleAlgorithms(schedule.algorithms);
        }
      })
      .catch(() => {}); // Silently ignore — the panel just shows defaults
  }, [spotifyId, isOwner]);


  // Applies the chosen shuffle algorithms to the current track list in memory
  // Saves the original order on first shuffle so the user can undo
  const handleShuffle = (algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }) => {
    if (!hasUnsavedChanges) setOriginalTracks([...tracks]);
    setTracks(applyShuffle(tracks, algorithms));
    setHasUnsavedChanges(true);
    setOpenTrackIds(new Set());
    setInsightsOpen(false);
    setShuffleModalOpen(false);
  };

  const reorderTracks = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    if (!hasUnsavedChanges) setOriginalTracks([...tracks]);

    setTracks(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return next;
    });

    setHasUnsavedChanges(true);
  };

  // Toggles a reshuffle algorithm checkbox
  // True Random is mutually exclusive with all other options (same logic as ShuffleModal)
  const toggleReshuffleAlgorithm = (key: keyof typeof reshuffleAlgorithms) => {
    if (key === 'trueRandom') {
      setReshuffleAlgorithms(prev => prev.trueRandom
        ? { ...prev, trueRandom: false }
        : { trueRandom: true, artistSpread: false, genreSpread: false, chronological: false }
      );
      return;
    }
    setReshuffleAlgorithms(prev => ({ ...prev, trueRandom: false, [key]: !prev[key] }));
  };

  // Saves the auto-reshuffle schedule to the database
  // On success, updates local state so the "next reshuffle" date shows immediately
  const handleSaveReshuffle = async () => {
    if (!spotifyId) return;
    setReshuffleLoading(true);
    try {
      const { schedule } = await enableReshuffle(
        getUserId(), spotifyId, name || '', reshuffleInterval, reshuffleAlgorithms
      );
      setReshuffleSchedule(schedule);
      setSaveSuccess('Auto-reshuffle scheduled!');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch {
      setSaveError('Failed to save auto-reshuffle settings.');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setReshuffleLoading(false);
    }
  };

  // Deletes the auto-reshuffle schedule from the database
  // Resets local state to defaults so the panel looks like a fresh setup
  const handleDisableReshuffle = async () => {
    if (!spotifyId) return;
    setReshuffleLoading(true);
    try {
      await disableReshuffle(getUserId(), spotifyId);
      setReshuffleSchedule(null);
      setReshuffleInterval(7);
      setReshuffleAlgorithms({ trueRandom: false, artistSpread: true, genreSpread: false, chronological: false });
      setSaveSuccess('Auto-reshuffle disabled.');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch {
      setSaveError('Failed to disable auto-reshuffle.');
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setReshuffleLoading(false);
    }
  };

  // Writes the current track order to the user's owned Spotify playlist
  const handleSave = async () => {
    if (!spotifyId) return;
    setSaveLoading(true);
    setSaveError(null);

    try {
      await savePlaylist(getUserId(), spotifyId, tracks);
      setHasUnsavedChanges(false);
      setSaveSuccess('Playlist saved successfully!');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch {
      setSaveError('Spotify restricts playlist modifications in development mode. This will work once the app is published.');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaveLoading(false);
    }
  };

  // Called when the user confirms the name in the CopyModal
  // Creates the new playlist on Spotify, then opens it in a new tab
  // ownerId and name are passed as query params so the new tab can read them
  // (React Router location.state does not survive across new tab opens)
  const handleConfirmCopy = async (copyName: string) => {
    setSaveLoading(true);
    setSaveError(null);

    try {
      const { playlist: newPlaylist } = await copyPlaylist(
        getUserId(),
        tracks.map(t => ({ id: t.id })),
        copyName
      );
      setCopyModalOpen(false);
      setHasUnsavedChanges(false);
      setSaveSuccess('Copy saved to your library!');
      setTimeout(() => setSaveSuccess(null), 3000);

      const params = new URLSearchParams({
        name: newPlaylist.name,
        ownerId: newPlaylist.ownerId,
      });
      window.open(`/playlist/${newPlaylist.spotifyId}?${params}`, '_blank');
    } catch {
      setSaveError('Spotify restricts playlist modifications in development mode. This will work once the app is published.');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading playlist...</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <p className="text-4xl mb-4">{isOwner ? '⚠️' : '🔒'}</p>
        <p className="text-text-primary text-lg font-semibold mb-2">
          {isOwner ? 'Something went wrong' : 'Playlist Unavailable'}
        </p>
        <p className="text-text-muted text-sm mb-2">{error}</p>
        {!isOwner && (
          <p className="text-text-muted text-sm mb-6">
            Tunecraft can only access playlists you own. Playlists created by other users are restricted.
          </p>
        )}
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-3 rounded-full transition-all duration-200"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">

      {/* Header */}
      <div className="border-b border-border-color px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-card/40 hover:bg-accent/10 text-accent border border-accent hover:border-accent shadow-sm transition-all duration-200 hover:-translate-x-0.5"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-colors duration-200">
              ←
            </span>
            <span className="text-sm font-semibold tracking-wide uppercase group-hover:text-accent">
              Back
            </span>
          </button>
          <div>
          <h1
            onClick={() => navigate('/dashboard')}
            className="text-2xl font-bold tracking-tight cursor-pointer w-fit"
          >
            Tune<span className="text-accent">Craft</span>
          </h1>
            {name && (
              <button
                type="button"
                onClick={() => {
                  if (!spotifyId) return;
                  const url = spotifyId === 'liked'
                    ? 'https://open.spotify.com/collection/tracks'
                    : `https://open.spotify.com/playlist/${spotifyId}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="text-lg font-semibold text-left text-text-primary hover:text-accent hover:underline cursor-pointer"
              >
                {name}
              </button>
            )}
            {/* Shows live loading progress as pages stream in */}
            <p className="text-text-muted text-sm">
              {loadingMore
                ? `Loading... ${tracks.length} of ${total} tracks`
                : `${tracks.length} tracks`
              }
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShuffleModalOpen(true)}
            disabled={loadingMore}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50  text-white font-semibold px-5 py-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          >
            🔀 Shuffle
          </button>
          {isOwner && spotifyId !== 'liked' && (
            <button
              onClick={handleSave}
              disabled={saveLoading || loadingMore}
              className="bg-bg-card hover:bg-bg-secondary disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full border border-border-color transition-all duration-200 hover:border-accent/50"
            >
              {saveLoading ? 'Saving...' : '💾 Save'}
            </button>
          )}
          <button
            onClick={() => setCopyModalOpen(true)}
            disabled={saveLoading || loadingMore}
            className="bg-bg-card hover:bg-bg-secondary disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full border border-border-color transition-all duration-200 hover:border-accent/50"
          >
            💾 Save as Copy
          </button>
        </div>
      </div>

      {/* Unsaved changes banner */}
      {hasUnsavedChanges && (
        <div className="bg-accent/10 px-8 py-3 flex items-center justify-between">
          <p className="text-accent text-sm font-medium">
            ✨ Playlist order updated — save to apply changes
          </p>
          <button
            onClick={() => {
              setTracks(originalTracks);
              setHasUnsavedChanges(false);
            }}
            className="text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            ↩ Undo
          </button>
        </div>
      )}

      <div className="px-8 py-2">

        {/* Auto-Reshuffle Panel — only shown to the playlist owner, not on Liked Songs */}
        {isOwner && spotifyId !== 'liked' && (
          <div className="mb-4 bg-bg-card rounded-2xl border border-border-color overflow-hidden">

            {/* Collapsible header — shows active badge when a schedule exists */}
            <button
              onClick={() => setReshuffleOpen(!reshuffleOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-secondary transition-colors duration-200"
            >
              <span className="flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-text-muted">
                ⏰ Auto-Reshuffle
                {reshuffleSchedule && (
                  <span className="normal-case tracking-normal font-medium text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </span>
              <span
                className="text-text-muted transition-transform duration-300 w-10 text-right"
                style={{ transform: reshuffleOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                ▼
              </span>
            </button>

            {reshuffleOpen && (
              <div className="px-6 pb-6 flex flex-col gap-5">

                {/* Status row — shows next scheduled reshuffle date if active */}
                {reshuffleSchedule ? (
                  <div className="bg-accent/10 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-accent text-sm font-semibold">Schedule active</p>
                      <p className="text-text-muted text-xs mt-0.5">
                        Next reshuffle:{' '}
                        {reshuffleSchedule.nextReshuffleAt
                          ? new Date(reshuffleSchedule.nextReshuffleAt).toLocaleDateString(undefined, {
                              weekday: 'short', month: 'short', day: 'numeric',
                            })
                          : '—'}
                      </p>
                      {reshuffleSchedule.lastReshuffledAt && (
                        <p className="text-text-muted text-xs">
                          Last reshuffled:{' '}
                          {new Date(reshuffleSchedule.lastReshuffledAt).toLocaleDateString(undefined, {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleDisableReshuffle}
                      disabled={reshuffleLoading}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      Disable
                    </button>
                  </div>
                ) : (
                  <p className="text-text-muted text-sm">
                    Tunecraft will automatically reshuffle this playlist on a schedule and save it to Spotify.
                  </p>
                )}

                {/* Interval picker */}
                <div>
                  <p className="text-text-muted text-xs uppercase tracking-widest mb-3">
                    Reshuffle every
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {[1, 3, 7, 14, 30].map(days => (
                      <button
                        key={days}
                        onClick={() => setReshuffleInterval(days)}
                        className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-200 ${
                          reshuffleInterval === days
                            ? 'bg-accent border-accent text-white'
                            : 'bg-bg-secondary border-border-color text-text-muted hover:border-accent/40'
                        }`}
                      >
                        {days === 1 ? 'Daily' : days === 7 ? 'Weekly' : days === 14 ? 'Bi-weekly' : days === 30 ? 'Monthly' : `${days} days`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Algorithm picker — same options as ShuffleModal */}
                <div>
                  <p className="text-text-muted text-xs uppercase tracking-widest mb-3">
                    Shuffle style
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'artistSpread', emoji: '🎤', label: 'Artist Spread' },
                      { key: 'genreSpread',  emoji: '🎨', label: 'Genre Spread' },
                      { key: 'chronological', emoji: '📅', label: 'Chronological' },
                      { key: 'trueRandom',   emoji: '🎲', label: 'True Random' },
                    ] as const).map(option => {
                      const isChecked = reshuffleAlgorithms[option.key];
                      const isDisabled = option.key !== 'trueRandom' && reshuffleAlgorithms.trueRandom;
                      return (
                        <button
                          key={option.key}
                          onClick={() => toggleReshuffleAlgorithm(option.key)}
                          disabled={isDisabled}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
                            isChecked ? 'border-accent bg-accent/10' : 'border-border-color hover:border-accent/40'
                          } ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isChecked ? 'bg-accent border-accent' : 'border-border-color'
                          }`}>
                            {isChecked && <span className="text-white text-xs leading-none">✓</span>}
                          </div>
                          <span className="text-sm font-medium text-text-primary">
                            {option.emoji} {option.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSaveReshuffle}
                  disabled={reshuffleLoading || !Object.values(reshuffleAlgorithms).some(Boolean)}
                  className="self-start bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  {reshuffleLoading ? 'Saving...' : reshuffleSchedule ? 'Update Schedule' : 'Activate Schedule'}
                </button>

              </div>
            )}
          </div>
        )}

        {/* Collapsible Insights Section */}
        <div className="mb-8 bg-bg-card rounded-2xl border border-border-color overflow-hidden">
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-secondary transition-colors duration-200"
          >
            <span className="text-sm font-semibold uppercase tracking-widest text-text-muted">
              Playlist Insights
              {loadingMore && (
                <span className="ml-2 text-accent/60 normal-case enableReshuffle-normal font-normal">
                  — updating as tracks load
                </span>
              )}
            </span>
            <span
              className="text-text-muted transition-transform duration-300 w-10 text-right"
              style={{ transform: insightsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ▼
            </span>
          </button>

          {insightsOpen && averages && (
            <div className="px-6 pb-6">
              {/* Row 1 — Audio feature donut charts */}
              <div className="grid grid-cols-4 md:grid-cols-7 gap-6 justify-items-center mb-8">
                {AUDIO_FEATURES.map(feature => (
                  <AudioFeatureChart
                    key={feature.key}
                    label={feature.label}
                    value={averages[feature.key as keyof PlaylistAverages]}
                    isTempo={feature.isTempo}
                    isLoading={loadingMore}
                  />
                ))}
              </div>

              {/* Row 2 — Genre and decade pie charts */}
              <PlaylistCompositionCharts
                tracks={tracks}
                isLoading={loadingMore}
              />
            </div>
          )}
        </div>

        {/* Track list */}
        <div className="mb-2 px-4">
          <button
            type="button"
            onClick={() => {
              if (openTrackIds.size === 0) {
                setOpenTrackIds(new Set(tracks.map(t => t.id)));
              } else {
                setOpenTrackIds(new Set());
              }
            }}
            className="text-text-muted hover:text-text-primary transition-colors duration-200 text-sm w-full flex items-center justify-end gap-2"
            title={openTrackIds.size === 0 ? 'Expand all tracks' : 'Collapse all tracks'}
            aria-label={openTrackIds.size === 0 ? 'Expand all tracks' : 'Collapse all tracks'}
          >
            <span>{openTrackIds.size === 0 ? 'Expand all' : 'Collapse all'}</span>
            <span className="inline-block w-10 text-right" aria-hidden="true">
              {openTrackIds.size === 0 ? '▼' : '▲'}
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {tracks.map((track, index) => (
            (() => {
              const isOpen = openTrackIds.has(track.id);
              return (
            <div
              key={track.id}
              className={[
                'group rounded-xl transition-colors duration-200',
                dragOverIndex === index ? 'bg-bg-card ring-1 ring-accent/30' : 'hover:bg-bg-card',
              ].filter(Boolean).join(' ')}
            >
              <div
                draggable={tracks.length > 1}
                onDragStart={() => {
                  dragFromIndexRef.current = index;
                }}
                onDragEnd={() => {
                  dragFromIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                onDragOver={(e) => {
                  if (dragFromIndexRef.current === null) return;
                  e.preventDefault();
                  if (dragOverIndex !== index) setDragOverIndex(index);
                }}
                onDrop={(e) => {
                  if (dragFromIndexRef.current === null) return;
                  e.preventDefault();
                  reorderTracks(dragFromIndexRef.current, index);
                  dragFromIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                className={[
                  'flex items-center gap-4 px-4 py-3',
                  tracks.length > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                ].filter(Boolean).join(' ')}
              >
                <span className="text-text-muted text-sm w-6 text-right shrink-0">
                  {index + 1}
                </span>
                <span
                  className={[
                    'text-text-muted w-6 text-center shrink-0 select-none',
                    tracks.length > 1 ? 'opacity-60 group-hover:opacity-100' : 'opacity-30',
                  ].join(' ')}
                  title="Drag to reorder"
                  aria-hidden="true"
                >
                  ⋮⋮
                </span>
                <div className="w-10 h-10 rounded-md overflow-hidden bg-bg-secondary shrink-0">
                  {track.albumImageUrl ? (
                    <img
                      src={track.albumImageUrl}
                      alt={track.albumName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted">
                      🎵
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const url = `https://open.spotify.com/track/${track.id}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="text-sm font-medium truncate text-left text-text-primary hover:text-accent hover:underline cursor-pointer"
                    title="Open in Spotify"
                  >
                    {track.name}
                  </button>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-text-muted text-xs truncate">{track.artist}</p>
                    {track.genres.slice(0, 2).map(genre => (
                      <span
                        key={genre}
                        className="text-accent text-xs bg-accent/10 px-2 py-0.5 rounded-full shrink-0"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-text-muted text-sm w-10 text-right shrink-0">
                  {formatDuration(track.durationMs)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenTrackIds(prev => {
                      const next = new Set(prev);
                      if (next.has(track.id)) next.delete(track.id);
                      else next.add(track.id);
                      return next;
                    });
                  }}
                  className="text-text-muted hover:text-text-primary transition-colors duration-200 shrink-0 w-10 text-right"
                  aria-label={isOpen ? 'Hide audio features' : 'Show audio features'}
                  title={isOpen ? 'Hide audio features' : 'Show audio features'}
                >
                  <span
                    className="inline-block transition-transform duration-300"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                </button>
              </div>

              {isOpen && (
                <div className="pl-24 pr-4 pb-3 pt-0">
                  <TrackAudioFeaturesCollapse track={track} />
                </div>
              )}
            </div>
              );
            })()
          ))}
        </div>

        {/* Background loading indicator at bottom of list */}
        {loadingMore && (
          <div className="flex justify-center py-8">
            <div className="text-accent/60 text-sm animate-pulse">
              Loading remaining tracks in background...
            </div>
          </div>
        )}
      </div>

      {/* Success toast */}
      {saveSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-3 rounded-full shadow-lg z-50">
          ✅ {saveSuccess}
        </div>
      )}

      {/* Failure toast */}
      {saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-lg z-50 text-center max-w-md">
          ⚠️ {saveError}
        </div>
      )}

      {/* Shuffle modal */}
      <ShuffleModal
        isOpen={shuffleModalOpen}
        isOwner={isOwner}
        playlistName={name || 'Playlist'}
        onClose={() => setShuffleModalOpen(false)}
        onShuffle={handleShuffle}
        isLoading={false}
      />

      {/* Copy modal — lets the user rename the playlist before saving */}
      <CopyModal
        isOpen={copyModalOpen}
        defaultName={`${name || 'My Playlist'} (Tunecraft Copy)`}
        isLoading={saveLoading}
        onClose={() => setCopyModalOpen(false)}
        onConfirm={handleConfirmCopy}
      />
    </div>
  );
}