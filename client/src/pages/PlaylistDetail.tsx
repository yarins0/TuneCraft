import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { getPlatformConfig } from '../utils/platform';
import { getActiveAccount, setSessionAccount } from '../utils/accounts';
import ShuffleModal from '../components/modals/ShuffleModal';
import CopyModal from '../components/modals/CopyModal';
import SplitModal from '../components/modals/SplitModal';
import TrackRow from '../components/TrackRow';
import DuplicatesWarning from '../components/DuplicatesWarning';
import { useAnimatedLabel } from '../hooks/useAnimatedLabel';
import useNumberStepper from '../hooks/useNumberStepper';
import { usePlaylistTracks } from '../hooks/usePlaylistTracks';
import { usePlaylistActions } from '../hooks/usePlaylistActions';
import { useReshuffleSchedule } from '../hooks/useReshuffleSchedule';
import { findDuplicates } from '../utils/findDuplicates';
import AppFooter from '../components/AppFooter';
import PlaylistHeader from '../components/PlaylistHeader';
import PlaylistInsights from '../components/PlaylistInsights';
import ChevronDown, { Toast, PlatformMismatchScreen, PlaylistLoadingScreen, PlaylistErrorScreen } from '../components/ui';

const getPlatformUserId = () => getActiveAccount()?.platformUserId || '';

export default function PlaylistDetail() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const location = useLocation();

  // location.state is set when navigating within the app via React Router.
  // searchParams is the fallback for when the page is opened in a new tab (e.g. after copy)
  // — new tabs don't carry React Router state, so we encode the info in the URL instead.
  const searchParams = new URLSearchParams(location.search);

  // If this page was opened in a new tab (middle-click / Ctrl+click from Dashboard),
  // React Router state is lost. The URL carries ?userId so we can activate the correct
  // account for this tab. Must run synchronously here — before any hook effects fire —
  // so getUserId() in usePlaylistTracks reads the right userId on its first call.
  const urlUserId = searchParams.get('userId');
  if (urlUserId && !sessionStorage.getItem('activeUserId')) {
    setSessionAccount(urlUserId);
  }

  const state = (location.state || {}) as { ownerId?: string; name?: string; platform?: string; trackCount?: number };
  const ownerId = state.ownerId || searchParams.get('ownerId') || undefined;
  const name = state.name || searchParams.get('name') || undefined;
  // trackCount from the dashboard playlist card — used as a display fallback for Tidal,
  // which doesn't always return meta.total in its API responses.
  const dashboardTrackCount = state.trackCount ?? (parseInt(searchParams.get('trackCount') ?? '', 10) || null);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [openTrackIds, setOpenTrackIds] = useState<Set<string>>(() => new Set());
  const [isDupesExpanded, setIsDupesExpanded] = useState(false);

  const [shuffleModalOpen, setShuffleModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);

  const dragFromIndexRef = useRef<number | null>(null);
  // Mirrors dragFromIndexRef as state so rows can react to it visually (dim/scale effect).
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // jumpingTrackIndex — the index of the track whose position number is currently being edited.
  // null means no row is in edit mode.
  const [jumpingTrackIndex, setJumpingTrackIndex] = useState<number | null>(null);

  // jumpInputValue — the raw string the user is typing in the position input.
  // Kept as a string while editing so partial input (e.g. "") doesn't force a number immediately.
  const [jumpInputValue, setJumpInputValue] = useState('');

  // ─── Track loading ────────────────────────────────────────────────────────────
  const { tracks, setTracks, averages, total, isLoading, isLoadingMore, error } = usePlaylistTracks(
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
    isReshuffleLoading,
    handleSaveReshuffle,
    handleDisableReshuffle,
  } = useReshuffleSchedule({ playlistId, isOwner, name, platform: playlistPlatform, onSuccess: showSuccess, onError: showError });

  // ─── Track editing and playlist persistence ───────────────────────────────────
  const {
    hasUnsavedChanges,
    isSaveLoading,
    isSplitLoading,
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
    onCopyComplete: () => setCopyModalOpen(false),
    onSplitComplete: () => setSplitModalOpen(false),
    onSuccess: showSuccess,
    onError: showError,
  });

  // Finds which track row the finger is currently over and updates the drop-target highlight.
  // Each row carries a data-track-index attribute so we can identify it from a touch point.
  const handleTouchDragMove = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest('[data-track-index]') as HTMLElement | null;
    if (!row) return;
    const idx = parseInt(row.getAttribute('data-track-index') ?? '', 10);
    if (!isNaN(idx) && dragOverIndex !== idx) setDragOverIndex(idx);
  };

  // Completes a touch drag — applies the reorder then clears all drag state.
  const handleTouchDrop = () => {
    if (dragFromIndexRef.current !== null && dragOverIndex !== null) {
      reorderTracks(dragFromIndexRef.current, dragOverIndex);
    }
    dragFromIndexRef.current = null;
    setDragFromIndex(null);
    setDragOverIndex(null);
  };

  // ─── Derived state ────────────────────────────────────────────────────────────

  // Fraction of loaded tracks that have at least one non-null audio feature.
  // SoundCloud tracks without an ISRC return all-null features (no ReccoBeats match).
  // When coverage is below 20%, audio feature charts and split strategies are hidden
  // so the UI doesn't show misleading averages computed from a tiny unrepresentative sample.
  //
  // Defaults to 1 while loading — keeps charts visible until we have the full picture.
  const audioFeatureCoverage = useMemo(() => {
    if (tracks.length === 0 || isLoadingMore) return 1;
    const withFeatures = tracks.filter(t =>
      Object.values(t.audioFeatures).some(v => v !== null)
    ).length;
    return withFeatures / tracks.length;
  }, [tracks, isLoadingMore]);

  // Reset the search query whenever the user navigates to a different playlist
  useEffect(() => { setSearchQuery(''); }, [playlistId]);

  // Filter the track list client-side — no server call needed.
  // Each result carries the track's original index so drag-to-reorder,
  // position jump, and duplicate highlighting all keep working correctly
  // even when only a subset of tracks is shown.
  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const indexed = tracks.map((track, index) => ({ track, index }));
    if (!q) return indexed;
    return indexed.filter(({ track: t }) =>
      t.name.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.albumName ?? '').toLowerCase().includes(q)
    );
  }, [tracks, searchQuery]);

  // Derives the list of duplicate entries every time the tracks array changes
  const duplicates = useMemo(() => findDuplicates(tracks), [tracks]);

  // Pre-compute which indexes are duplicates so each TrackRow can apply a red tint
  const duplicateIndexSet = useMemo(
    () => new Set(duplicates.map(d => d.index)),
    [duplicates]
  );

  // Provides increment/decrement helpers and reversed arrow-key handling for the jump input
  const jumpStepper = useNumberStepper(jumpInputValue, setJumpInputValue, 1, tracks.length);

  // Animated labels for the Save and Save as Copy buttons while isSaveLoading is true
  const saveLabel = useAnimatedLabel(isSaveLoading, '💾 Saving');
  const copyLabel = useAnimatedLabel(isSaveLoading, '💾 Saving as Copy');

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
    <PlatformMismatchScreen
      playlistPlatform={playlistPlatform!}
      activeAccountPlatform={activeAccount!.platform.toUpperCase()}
    />
  );

  if (isLoading) return <PlaylistLoadingScreen />;

  if (error) return (
    <PlaylistErrorScreen isOwner={isOwner} platformConfig={platformConfig} error={error} />
  );

  return (
    <div className="bg-bg-primary text-text-primary flex flex-col">
      <div className="min-h-screen">

      {/* Header */}
      <PlaylistHeader
        name={name}
        tracks={tracks}
        playlistId={playlistId!}
        isLoadingMore={isLoadingMore}
        total={total}
        platformConfig={platformConfig}
        dashboardTrackCount={dashboardTrackCount}
        reshuffleSchedule={reshuffleSchedule}
        isSaveLoading={isSaveLoading}
        saveLabel={saveLabel}
        copyLabel={copyLabel}
        isOwner={isOwner}
        onShuffleOpen={() => setShuffleModalOpen(true)}
        onSplitOpen={() => setSplitModalOpen(true)}
        onSave={handleSave}
        onCopyOpen={() => setCopyModalOpen(true)}
      />

      {/* Unsaved changes banner */}
      {hasUnsavedChanges && (
        <div className="bg-accent/10 px-4 sm:px-8 py-3 flex items-center justify-between">
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

      <div className="px-4 sm:px-8 py-2">

        {/* Collapsible Insights Section */}
        <PlaylistInsights
          isOpen={insightsOpen}
          onToggle={() => setInsightsOpen(!insightsOpen)}
          isLoadingMore={isLoadingMore}
          averages={averages}
          audioFeatureCoverage={audioFeatureCoverage}
          platformConfig={platformConfig}
          tracks={tracks}
        />

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

        {/* Search bar — filters the track list client-side across name, artist, and album */}
        {tracks.length > 0 && (
          <div className="mb-3 px-4 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tracks, artists, albums..."
              className="w-full bg-bg-card border border-border-color rounded-xl px-4 py-2 pr-9 text-sm
                         text-text-primary placeholder-text-muted
                         focus:outline-none focus:border-accent/50 transition-colors duration-200"
            />
            {/* Clear button — only shown when there is an active query */}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors duration-200"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
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
            <ChevronDown isOpen={openTrackIds.size > 0} />
          </button>
        </div>

        {/* Column headers — mirror the 3-column grid layout in TrackRow.
            The leading padding accounts for: position number (w-6) + drag handle (w-6) + album art (w-10) + gaps */}
        {tracks.length > 0 && (
          <div className="hidden sm:grid sm:grid-cols-[2fr_1fr_1fr] gap-x-4 px-4 pb-1 pl-[7.5rem] text-text-muted text-xs uppercase tracking-wider">
            <span>Track</span>
            <span>Artist</span>
            <span>Album</span>
          </div>
        )}

        {/* Empty state — playlist has no tracks at all */}
        {!isLoading && !isLoadingMore && tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <span className="text-5xl">🎵</span>
            <p className="text-text-primary font-semibold">This playlist is empty.</p>
            <p className="text-text-muted text-sm">
              Add tracks on your streaming platform to get started.
            </p>
          </div>
        )}

        {/* Empty-search state — tracks exist but none match the current query */}
        {tracks.length > 0 && filteredTracks.length === 0 && searchQuery.trim() && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <span className="text-4xl">🔍</span>
            <p className="text-text-muted text-sm">No tracks match your search.</p>
          </div>
        )}

        {/* Track list — renders only the filtered subset while a search is active.
            Each item carries the original index so drag, jump, and duplicate
            highlighting all reference positions in the full unfiltered array. */}
        <div className="flex flex-col gap-2">
          {filteredTracks.map(({ track, index }) => (
            <TrackRow
              key={`track-${index}`}
              track={track}
              index={index}
              totalTracks={tracks.length}
              isOpen={openTrackIds.has(track.id)}
              isDuplicate={duplicateIndexSet.has(index)}
              isDragging={dragFromIndex === index}
              dragOverIndex={dragOverIndex}
              onDragStart={() => { dragFromIndexRef.current = index; setDragFromIndex(index); }}
              onDragEnd={() => { dragFromIndexRef.current = null; setDragFromIndex(null); setDragOverIndex(null); }}
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
              onTouchDragMove={handleTouchDragMove}
              onTouchDrop={handleTouchDrop}
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
        {isLoadingMore && (
          <div className="flex justify-center py-8">
            <div className="text-accent/60 text-sm animate-pulse">
              Loading remaining tracks in background...
            </div>
          </div>
        )}
      </div>

      <Toast variant="success" message={saveSuccess} />
      <Toast variant="error"   message={saveError} />

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
        isReshuffleLoading={isReshuffleLoading}
      />

      <CopyModal
        isOpen={copyModalOpen}
        defaultName={`${name || 'My Playlist'} (Tunecraft Copy)`}
        isLoading={isSaveLoading}
        onClose={() => setCopyModalOpen(false)}
        onConfirm={handleConfirmCopy}
      />

      <SplitModal
        isOpen={splitModalOpen}
        playlistName={name || 'My Playlist'}
        tracks={tracks}
        isLoading={isSplitLoading}
        audioFeatureCoverage={audioFeatureCoverage}
        onClose={() => setSplitModalOpen(false)}
        onConfirm={handleConfirmSplit}
      />
      </div>

      <AppFooter />
    </div>
  );
}
