import { useMemo, useRef, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import type { PlaylistAverages } from '../api/tracks';
import { getPlatformPlaylistUrl, getPlatformLabel, getPlatformBadgeStyle, getPlatformConfig, PLATFORM_LABELS } from '../utils/platform';
import { getActiveAccount } from '../utils/accounts';
import AudioFeatureChart from '../components/AudioFeatureChart';
import { AUDIO_FEATURES } from '../constants/audioFeatures';
import PlaylistCompositionCharts from '../components/PlaylistCompositionCharts';
import ShuffleModal from '../components/ShuffleModal';
import CopyModal from '../components/CopyModal';
import SplitModal from '../components/SplitModal';
import TrackRow from '../components/TrackRow';
import DuplicatesWarning from '../components/DuplicatesWarning';
import { useAnimatedLabel } from '../hooks/useAnimatedLabel';
import useNumberStepper from '../hooks/useNumberStepper';
import { usePlaylistTracks } from '../hooks/usePlaylistTracks';
import { usePlaylistActions } from '../hooks/usePlaylistActions';
import { useReshuffleSchedule } from '../hooks/useReshuffleSchedule';
import { findDuplicates } from '../utils/findDuplicates';
import AppFooter from '../components/AppFooter';

const getPlatformUserId = () => localStorage.getItem('platformUserId') || '';

export default function PlaylistDetail() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const location = useLocation();

  // location.state is set when navigating within the app via React Router.
  // searchParams is the fallback for when the page is opened in a new tab (e.g. after copy)
  // — new tabs don't carry React Router state, so we encode the info in the URL instead.
  const searchParams = new URLSearchParams(location.search);
  const state = (location.state || {}) as { ownerId?: string; name?: string; platform?: string; trackCount?: number };
  const ownerId = state.ownerId || searchParams.get('ownerId') || undefined;
  const name = state.name || searchParams.get('name') || undefined;
  // trackCount from the dashboard playlist card — used as a display fallback for Tidal,
  // which doesn't always return meta.total in its API responses.
  const dashboardTrackCount = state.trackCount ?? null;
  // platform in state lets us detect cross-platform navigation before the API call.
  // Only populated when navigating from within the app (Dashboard links pass it).
  const playlistPlatform = (state.platform || searchParams.get('platform') || undefined)?.toUpperCase();

  // Resolved once here so no component below needs to compare against platform name strings.
  // Falls back to defaultConfig (all-safe values) when platform is unknown or undefined.
  const platformConfig = getPlatformConfig(playlistPlatform);

  // Check if the user is trying to view a playlist from a different platform than they're logged in as.
  // We only check when we have platform info from nav state — direct URL visits fall through to the server error.
  const activeAccount = getActiveAccount();
  const platformMismatch =
    playlistPlatform &&
    activeAccount &&
    playlistPlatform !== activeAccount.platform.toUpperCase();

  const isOwner = ownerId === getPlatformUserId();

  // ─── Toast state ─────────────────────────────────────────────────────────────
  // Shared between usePlaylistActions and useReshuffleSchedule via callbacks below
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const showSuccess = (msg: string, durationMs = 3000) => {
    setSaveSuccess(msg);
    setTimeout(() => setSaveSuccess(null), durationMs);
  };

  const showError = (msg: string, durationMs = 4000) => {
    setSaveError(msg);
    setTimeout(() => setSaveError(null), durationMs);
  };

  // ─── UI state ────────────────────────────────────────────────────────────────
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [openTrackIds, setOpenTrackIds] = useState<Set<string>>(() => new Set());
  const [isDupesExpanded, setIsDupesExpanded] = useState(false);

  const [shuffleModalOpen, setShuffleModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);

  const dragFromIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // jumpingTrackIndex — the index of the track whose position number is currently being edited.
  // null means no row is in edit mode.
  const [jumpingTrackIndex, setJumpingTrackIndex] = useState<number | null>(null);

  // jumpInputValue — the raw string the user is typing in the position input.
  // Kept as a string while editing so partial input (e.g. "") doesn't force a number immediately.
  const [jumpInputValue, setJumpInputValue] = useState('');

  // ─── Track loading ────────────────────────────────────────────────────────────
  const { tracks, setTracks, averages, total, loading, loadingMore, error } = usePlaylistTracks(
    // Suppress loading entirely when we already know the platform is wrong
    platformMismatch ? undefined : playlistId,
    () => {
      // Reset UI state when navigating to a different playlist
      setOpenTrackIds(new Set());
      setIsDupesExpanded(false);
    }
  );

  // ─── Reshuffle schedule ───────────────────────────────────────────────────────
  const {
    reshuffleSchedule,
    setReshuffleSchedule,
    reshuffleInterval,
    setReshuffleInterval,
    reshuffleAlgorithms,
    reshuffleLoading,
    handleSaveReshuffle,
    handleDisableReshuffle,
  } = useReshuffleSchedule({ playlistId, isOwner, name, onSuccess: showSuccess, onError: showError });

  // ─── Track editing and playlist persistence ───────────────────────────────────
  const {
    hasUnsavedChanges,
    saveLoading,
    splitLoading,
    handleShuffle,
    reorderTracks,
    handleRemoveDuplicate,
    handleRemoveAllDuplicates,
    handleSave,
    handleConfirmCopy,
    handleConfirmSplit,
    undoChanges,
  } = usePlaylistActions({
    playlistId,
    name,
    tracks,
    setTracks,
    reshuffleSchedule,
    setReshuffleSchedule,
    onShuffleApplied: () => {
      // Close the shuffle modal and collapse all open track rows after a shuffle
      setShuffleModalOpen(false);
      setOpenTrackIds(new Set());
      setInsightsOpen(false);
    },
    onSuccess: showSuccess,
    onError: showError,
  });

  // ─── Derived state ────────────────────────────────────────────────────────────

  // Fraction of loaded tracks that have at least one non-null audio feature.
  // SoundCloud tracks without an ISRC return all-null features (no ReccoBeats match).
  // When coverage is below 20%, audio feature charts and split strategies are hidden
  // so the UI doesn't show misleading averages computed from a tiny unrepresentative sample.
  //
  // Defaults to 1 while loading — keeps charts visible until we have the full picture.
  const audioFeatureCoverage = useMemo(() => {
    if (tracks.length === 0 || loadingMore) return 1;
    const withFeatures = tracks.filter(t =>
      Object.values(t.audioFeatures).some(v => v !== null)
    ).length;
    return withFeatures / tracks.length;
  }, [tracks, loadingMore]);

  // Derives the list of duplicate entries every time the tracks array changes
  const duplicates = useMemo(() => findDuplicates(tracks), [tracks]);

  // Pre-compute which indexes are duplicates so each TrackRow can apply a red tint
  const duplicateIndexSet = useMemo(
    () => new Set(duplicates.map(d => d.index)),
    [duplicates]
  );

  // Provides increment/decrement helpers and reversed arrow-key handling for the jump input
  const jumpStepper = useNumberStepper(jumpInputValue, setJumpInputValue, 1, tracks.length);

  // Animated labels for the Save and Save as Copy buttons while saveLoading is true
  const saveLabel = useAnimatedLabel(saveLoading, '💾 Saving');
  const copyLabel = useAnimatedLabel(saveLoading, '💾 Saving as Copy');

  // Confirms a position jump when the user presses Enter or blurs the input.
  // fromIndex is 0-based (array index); the input value is 1-based (display position).
  // Clamps out-of-range values to the nearest valid position — forgiving, not strict.
  const confirmJump = (fromIndex: number) => {
    const parsed = parseInt(jumpInputValue, 10);
    const toIndex = isNaN(parsed)
      ? fromIndex
      : Math.min(Math.max(parsed - 1, 0), tracks.length - 1);

    if (toIndex !== fromIndex) reorderTracks(fromIndex, toIndex);
    setJumpingTrackIndex(null);
    setJumpInputValue('');
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (platformMismatch) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <p className="text-4xl mb-4">🔄</p>
        <p className="text-text-primary text-lg font-semibold mb-2">Wrong Platform</p>
        <p className="text-text-muted text-sm mb-6">
          This playlist is from{' '}
          <span className="text-text-primary font-medium">
            {PLATFORM_LABELS[playlistPlatform!] ?? playlistPlatform}
          </span>
          , but you're currently logged in with{' '}
          <span className="text-text-primary font-medium">
            {PLATFORM_LABELS[activeAccount!.platform.toUpperCase()] ?? activeAccount!.platform}
          </span>
          . Switch accounts on the dashboard to view this playlist.
        </p>
        <Link
          to="/dashboard"
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-3 rounded-full transition-all duration-200 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading playlist...</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        {/* ownershipRestricted is declared per-platform in the platform config — no string comparison needed */}
        <p className="text-4xl mb-4">{!isOwner && platformConfig.ownershipRestricted ? '🔒' : '⚠️'}</p>
        <p className="text-text-primary text-lg font-semibold mb-2">
          {!isOwner && platformConfig.ownershipRestricted ? 'Playlist Unavailable' : 'Something went wrong'}
        </p>
        <p className="text-text-muted text-sm mb-2">{error}</p>
        {!isOwner && platformConfig.ownershipRestricted && (
          <p className="text-text-muted text-sm mb-4">
            {platformConfig.label} restricts access to playlists owned by other users.
          </p>
        )}
        {/* Cross-platform hint — shown whenever the error is not an ownership restriction. */}
        {(isOwner || !platformConfig.ownershipRestricted) && (
          <p className="text-text-muted text-sm mb-6">
            If this playlist belongs to a different platform than the one you're currently logged into,
            try switching accounts on the dashboard.
          </p>
        )}
        <Link
          to="/dashboard"
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-3 rounded-full transition-all duration-200 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );

  return (
    <div className="bg-bg-primary text-text-primary flex flex-col">
      <div className="min-h-screen">

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border-color px-8 py-6 flex items-center justify-between bg-bg-secondary">
        <div className="flex items-center gap-4">

          {/* Logo — clicking navigates back to dashboard */}
          <Link to="/dashboard" className="flex items-center gap-2 cursor-pointer shrink-0">
            <img src="/favicon.svg" alt="TuneCraft icon" className="h-7 w-7" />
            <h1 className="text-2xl font-bold tracking-tight">
              Tune<span className="text-accent">Craft</span>
            </h1>
          </Link>

          <div className="h-8 w-px bg-border-color shrink-0" />

          {/* Playlist name + live track count */}
          <div className="min-w-0">
            {name && (
              <button
                type="button"
                onClick={() => {
                  if (!playlistId) return;
                  const platform = tracks[0]?.platform;
                  const url = getPlatformPlaylistUrl(platform, playlistId);
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                title={getPlatformLabel(tracks[0]?.platform)}
                className="text-lg font-semibold text-left text-text-primary hover:text-accent hover:underline cursor-pointer truncate max-w-xs block"
              >
                {name}
              </button>
            )}
            <p className="text-text-muted text-sm flex items-center gap-2">
              {loadingMore
                ? (() => {
                    // When totalTracksReliable is false (e.g. Tidal), the API often omits meta.total,
                    // so `total` equals the accumulated page count rather than the real track count.
                    // Fall back to the count the dashboard already knew from the playlist list API.
                    const displayTotal =
                      total > tracks.length
                        ? total                                            // real total from the API
                        : !platformConfig.totalTracksReliable && dashboardTrackCount
                          ? dashboardTrackCount                            // dashboard fallback
                          : null;                                         // unknown — don't show "X of Y"
                    return displayTotal
                      ? `Loading... ${tracks.length} of ${displayTotal} tracks`
                      : `Loading... ${tracks.length} tracks`;
                  })()
                : `${tracks.length} tracks`
              }
              {/* Platform badge — shown for every platform, coloured with the platform's brand colour */}
              {tracks.length > 0 && tracks[0]?.platform && (
                <span
                  className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
                  style={getPlatformBadgeStyle(tracks[0].platform)}
                >
                  {tracks[0].platform}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShuffleModalOpen(true)}
            disabled={loadingMore}
            className={`bg-accent hover:bg-bg-secondary
            disabled:opacity-50 text-white font-semibold px-5 rounded-full
            transition-all duration-200 hover:scale-105 active:scale-95
            flex flex-col items-center ${reshuffleSchedule ? 'py-0.5' : 'py-2'}`}
          >
            <span>🔀 Shuffle</span>
            {reshuffleSchedule && (
              <span className="text-xs font-normal opacity-80 leading-tight">Active</span>
            )}
          </button>
          {isOwner && (
            <>
              <button
                onClick={() => setSplitModalOpen(true)}
                disabled={loadingMore}
                className="bg-accent hover:bg-bg-secondary
                disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full
                border border-border-color transition-all duration-200 hover:border-accent/50"
              >
                ✂️ Split
              </button>
              {playlistId !== 'liked' && (
                <button
                  onClick={handleSave}
                  disabled={saveLoading || loadingMore}
                  className="bg-bg-card hover:bg-bg-secondary
                  disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full
                  border border-border-color transition-all duration-200 hover:border-accent/50"
                >
                  <span className="inline-block w-[90px] text-center">
                    {saveLoading ? saveLabel : '💾 Save'}
                  </span>
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setCopyModalOpen(true)}
            disabled={saveLoading || loadingMore}
            className="bg-bg-card hover:bg-bg-secondary
                      disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full
                      border border-border-color transition-all duration-200 hover:border-accent/50"
          >
            <span className="inline-block w-[150px] text-center">
              {saveLoading ? copyLabel : '💾 Save as copy'}
            </span>
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
            onClick={undoChanges}
            className="text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            ↩ Undo
          </button>
        </div>
      )}

      <div className="px-8 py-2">

        {/* Collapsible Insights Section */}
        <div className="mb-8 bg-bg-card rounded-2xl border border-border-color overflow-hidden">
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-secondary transition-colors duration-200"
          >
            <span className="text-sm font-semibold uppercase tracking-widest text-text-muted">
              Playlist Insights
              {loadingMore && (
                <span className="ml-2 text-accent/60 normal-case font-normal">
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
              {/* Audio feature charts — hidden when <20% of tracks have features */}
              {audioFeatureCoverage >= 0.2 ? (
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
              ) : (
                <div className="flex items-center gap-3 text-text-muted text-sm mb-8 px-1 py-3 bg-bg-secondary rounded-xl border border-border-color">
                  <span className="text-2xl shrink-0 pl-1">🎙️</span>
                  <span>
                    {platformConfig.audioFeaturesMissingHint
                      ? `Audio feature data isn't available for most tracks here — ${platformConfig.audioFeaturesMissingHint}`
                      : "Audio feature data isn't available for most tracks here."}
                  </span>
                </div>
              )}
              {/* Genre and decade charts — always shown; sourced from Last.fm */}
              <PlaylistCompositionCharts tracks={tracks} isLoading={loadingMore} />
            </div>
          )}
        </div>

        {/* Duplicate warning */}
        {duplicates.length > 0 && (
          <DuplicatesWarning
            duplicates={duplicates}
            isDupesExpanded={isDupesExpanded}
            onToggleExpand={() => setIsDupesExpanded(prev => !prev)}
            onRemove={handleRemoveDuplicate}
            onRemoveAll={handleRemoveAllDuplicates}
          />
        )}

        {/* Expand / collapse all toggle */}
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

        {/* Empty state */}
        {!loading && !loadingMore && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <span className="text-5xl">🎵</span>
            <p className="text-text-primary font-semibold">This playlist is empty.</p>
            <p className="text-text-muted text-sm">
              Add tracks on your streaming platform to get started.
            </p>
          </div>
        )}

        {/* Track list */}
        <div className="flex flex-col gap-2">
          {tracks.map((track, index) => (
            <TrackRow
              key={`track-${index}`}
              track={track}
              index={index}
              totalTracks={tracks.length}
              isOpen={openTrackIds.has(track.id)}
              isDuplicate={duplicateIndexSet.has(index)}
              dragOverIndex={dragOverIndex}
              onDragStart={() => { dragFromIndexRef.current = index; }}
              onDragEnd={() => { dragFromIndexRef.current = null; setDragOverIndex(null); }}
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
              isJumping={jumpingTrackIndex === index}
              jumpInputValue={jumpInputValue}
              jumpStepper={jumpStepper}
              onJumpInputChange={setJumpInputValue}
              onJumpConfirm={() => confirmJump(index)}
              onJumpCancel={() => { setJumpingTrackIndex(null); setJumpInputValue(''); }}
              onJumpStart={() => { setJumpingTrackIndex(index); setJumpInputValue(String(index + 1)); }}
              onToggleOpen={() => {
                setOpenTrackIds(prev => {
                  const next = new Set(prev);
                  if (next.has(track.id)) next.delete(track.id);
                  else next.add(track.id);
                  return next;
                });
              }}
            />
          ))}
        </div>

        {/* Background loading indicator */}
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

      {/* Error toast */}
      {saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-lg z-50 text-center max-w-md">
          ⚠️ {saveError}
        </div>
      )}

      <ShuffleModal
        isOpen={shuffleModalOpen}
        isOwner={isOwner}
        playlistName={name || 'Playlist'}
        onClose={() => setShuffleModalOpen(false)}
        onShuffle={handleShuffle}
        isLoading={false}
        canScheduleReshuffle={isOwner && playlistId !== 'liked'}
        reshuffleSchedule={reshuffleSchedule}
        reshuffleInterval={reshuffleInterval}
        setReshuffleInterval={setReshuffleInterval}
        initialAlgorithms={reshuffleAlgorithms}
        onSaveReshuffle={handleSaveReshuffle}
        onDisableReshuffle={handleDisableReshuffle}
        reshuffleLoading={reshuffleLoading}
      />

      <CopyModal
        isOpen={copyModalOpen}
        defaultName={`${name || 'My Playlist'} (Tunecraft Copy)`}
        isLoading={saveLoading}
        onClose={() => setCopyModalOpen(false)}
        onConfirm={handleConfirmCopy}
      />

      <SplitModal
        isOpen={splitModalOpen}
        playlistName={name || 'My Playlist'}
        tracks={tracks}
        isLoading={splitLoading}
        audioFeatureCoverage={audioFeatureCoverage}
        onClose={() => setSplitModalOpen(false)}
        onConfirm={handleConfirmSplit}
      />
      </div>

      <AppFooter />
    </div>
  );
}
