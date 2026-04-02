import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { fetchPlaylists, fetchLikedSongs } from '../api/playlists';
import type { Playlist } from '../api/playlists';
import { extractPlaylistId } from '../utils/platform';
import { discoverPlaylist, discoverPlaylistByUrl } from '../api/playlists';
import MergeModal from '../components/modals/MergeModal';
import { mergePlaylist } from '../api/playlists';
import { buildMergedTrackList } from '../utils/mergePlaylists';
import { getActiveAccount, getAccounts, setSessionAccount, type StoredAccount } from '../utils/accounts';
import PlatformSwitcherSidebar from '../components/PlatformSwitcherSidebar';
import AppFooter from '../components/AppFooter';
import { PLATFORM_COLORS, PLATFORM_LABELS, getPlatformConfig } from '../utils/platform';
import { useAnimatedLabel } from '../hooks/useAnimatedLabel';

const getUserId = () => getActiveAccount()?.userId || '';
const getPlatformUserId = () => getActiveAccount()?.platformUserId ?? null;

// Sentinel ID used to represent Liked Songs in the selection set
// Liked Songs have no real Spotify playlist ID, so we use this constant as a stand-in
// The backend merge handler will detect this value and fetch /me/tracks instead of /playlists/:id/items
const LIKED_SONGS_ID = 'liked';

// Builds a playlist URL with all context encoded as query params.
// React Router state is lost when a link is opened in a new tab — URL params are the
// only way to carry context (account, platform, name, etc.) to PlaylistDetail.
// PlaylistDetail already reads these as fallbacks; this ensures they're always present.
function buildPlaylistUrl(platformId: string, opts: {
  userId: string;
  ownerId: string;
  name: string;
  platform: string;
  trackCount?: number | null;
}): string {
  const q = new URLSearchParams({
    userId:   opts.userId,
    ownerId:  opts.ownerId,
    name:     opts.name,
    platform: opts.platform,
  });
  if (opts.trackCount != null) q.set('trackCount', String(opts.trackCount));
  return `/playlist/${platformId}?${q}`;
}

export default function Dashboard() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedCount, setLikedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discoverInput, setDiscoverInput] = useState('');
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // --- Platform Switcher state ---
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // activeAccount drives the account button label in the header.
  // Re-read from localStorage on every switch.
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(() => getActiveAccount());
  // Derived from the active account's platform — controls platform-specific UI behaviour.
  // Falls back to safe defaults when no account is loaded yet.
  const platformConfig = getPlatformConfig(activeAccount?.platform?.toUpperCase());

  // --- Phase 5: Merge modal state ---
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // --- Phase 5: Multi-select state ---
  // selectMode becomes true the moment the user checks any playlist
  const [selectMode, setSelectMode] = useState(false);
  // selectedIds holds platformIds of checked playlists (owned + following when selectable) plus LIKED_SONGS_ID
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const navigate = useNavigate();
  const location = useLocation();

  // Animates "Loading your music." → ".." → "..." while the library is fetching.
  const loadingLabel = useAnimatedLabel(loading, 'Loading your music');
  // Animates "Loading." → ".." → "..." on the discover Go button while fetching playlist metadata.
  const discoverLoadingLabel = useAnimatedLabel(discoverLoading, 'Loading');

  // Monotonically increasing counter — incremented every time a new load starts.
  // Each loadLibrary call captures the current value; the .then() handler discards
  // its result if the counter has advanced (i.e. a newer load has already started).
  // This prevents a slow Tidal response from overwriting a Spotify library that
  // loaded after the user switched platforms mid-flight.
  const loadGenRef = useRef(0);

  // loadLibrary fetches playlists and liked-song count for the currently active account.
  // Extracted into a useCallback so it can be called both on mount and after an account switch.
  const loadLibrary = useCallback(() => {
    const userId = getUserId();

    if (!userId) {
      setError('No user session found. Please log in again.');
      setLoading(false);
      return;
    }

    // Claim this load's generation slot before any async work starts.
    const gen = ++loadGenRef.current;

    setLoading(true);
    setError(null);

    // Fetch both playlists and liked songs count in parallel.
    Promise.all([
      fetchPlaylists(userId),
      fetchLikedSongs(userId),
    ])
      .then(([playlistData, likedData]) => {
        // Discard if a newer load has started since this one was fired.
        // Covers: switching platforms, double-clicking retry, or tab focus restoring a stale request.
        if (gen !== loadGenRef.current) return;
        setPlaylists(playlistData);
        setLikedCount(likedData.trackCount);
        setLoading(false);
      })
      .catch(() => {
        if (gen !== loadGenRef.current) return;
        setError('Failed to load playlists');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // Skip if ?switchTo is present — the switchTo effect below will activate the correct
    // account and call loadLibrary() itself. Without this guard, the initial load would
    // run with the old localStorage account and briefly show the wrong playlists.
    if (new URLSearchParams(window.location.search).get('switchTo')) return;
    loadLibrary();
  }, [loadLibrary]);

  // Called by PlatformSwitcherSidebar when the user picks a different account.
  // The sidebar already called persistActiveAccount() to sync localStorage before this runs,
  // so getUserId() will return the new account's userId when loadLibrary fires.
  const handleAccountSwitch = (userId: string) => {
    // Refresh the displayed account info in the header
    const accounts = getAccounts();
    const account = accounts.find(a => a.userId === userId) ?? null;
    setActiveAccount(account);
    // Reset select mode so stale selections from the old account don't carry over
    exitSelectMode();
    // Re-fetch playlists for the newly active account
    loadLibrary();
  };

  // When Dashboard is opened in a new tab via a ?switchTo=userId link (e.g. from the
  // platform switcher sidebar), activate that account and re-fetch the library.
  // We strip the param from the URL immediately so refreshing the tab doesn't re-trigger.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const switchTo = params.get('switchTo');
    if (!switchTo) return;

    // Write to sessionStorage only — this tab gets the target account without
    // affecting localStorage (which would silently switch every other open tab).
    setSessionAccount(switchTo);
    handleAccountSwitch(switchTo);

    // Replace the current URL without the query param
    navigate('/dashboard', { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — runs once on mount; location.search is stable at that point

  // Handles the discover form submission.
  // extractPlaylistId returns either a bare platform ID or a full URL (SoundCloud only),
  // and only accepts URLs/IDs that match the active platform — cross-platform URLs return null.
  // Full SoundCloud URLs are sent to the server for slug → ID resolution.
  //
  // openInNewTab: when true, opens the playlist in a new browser tab instead of navigating
  // in place. Query params are used instead of router state because window.open() can't
  // carry React Router state — PlaylistDetail already reads ?ownerId= and ?name= as fallback.
  const handleDiscover = async (openInNewTab = false) => {
    setDiscoverError(null);
    const activePlatform = activeAccount?.platform ?? '';
    const extracted = extractPlaylistId(discoverInput, activePlatform);

    if (!extracted) {
      const platformLabel = PLATFORM_LABELS[activePlatform] ?? activePlatform;
      setDiscoverError(`Please enter a valid ${platformLabel} playlist URL`);
      return;
    }

    setDiscoverLoading(true);

    try {
      // If extractPlaylistId returned a full URL, the platform needs server-side slug resolution.
      // The server routes it to the active adapter's fetchPlaylist, which handles URL-vs-ID internally.
      const playlist = extracted.startsWith('https://')
        ? await discoverPlaylistByUrl(getUserId(), extracted)
        : await discoverPlaylist(getUserId(), extracted);

      const path = `/playlist/${playlist.platformId}`;

      if (openInNewTab) {
        window.open(buildPlaylistUrl(playlist.platformId, {
          userId:   getUserId(),
          ownerId:  playlist.ownerId,
          name:     playlist.name,
          platform: activeAccount?.platform ?? '',
        }), '_blank');
      } else {
        navigate(path, {
          state: { ownerId: playlist.ownerId, name: playlist.name, platform: activeAccount?.platform },
        });
      }
    } catch (error: any) {
      setDiscoverError(error.message);
    } finally {
      setDiscoverLoading(false);
    }
  };

  // Clears the selection and exits select mode
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Fetches all tracks from the selected playlists, deduplicates if requested,
  // then calls the backend to create the merged Spotify playlist
  const handleMerge = async (name: string, removeDuplicates: boolean) => {
    setMergeLoading(true);
    try {
      // Build the ordered list of IDs to merge — 'liked' is the sentinel for Liked Songs
      // The order here determines which playlist's tracks come first in the merged result
      const playlistIds = [
        ...(likedSongsSelected ? ['liked'] : []),
        ...selectedPlaylists.map(p => p.platformId),
      ];

      const tracks = await buildMergedTrackList(getUserId(), playlistIds, removeDuplicates);
      const { playlist: newPlaylist } = await mergePlaylist(getUserId(), tracks, name);

      setMergeModalOpen(false);
      exitSelectMode();

      // Navigate to the newly created playlist so the user can see the result immediately
      navigate(`/playlist/${newPlaylist.platformId}`, {
        state: { ownerId: newPlaylist.ownerId, name: newPlaylist.name, platform: activeAccount?.platform },
      });

      setMergeSuccess('Playlists merged! Opening new playlist...');
      setTimeout(() => setMergeSuccess(null), 4000);
    } catch {
      setMergeError('Failed to merge playlists. Please try again.');
      setTimeout(() => setMergeError(null), 5000);
    } finally {
      setMergeLoading(false);
    }
  };

  // Adds or removes an ID from the selection
  // Automatically exits select mode if the last item is unchecked
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  // Called when a checkbox is clicked — enters select mode on the first check
  // stopPropagation prevents the click from bubbling up to the card's onClick (which would navigate)
  const handleCheckboxClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // stop the click bubbling to the Link's onClick
    e.preventDefault();  // stop the browser following the anchor's href (stopPropagation alone doesn't prevent this)
    if (!selectMode) setSelectMode(true);
    toggleSelection(id);
  };

  // Called when the card body itself is clicked
  // In select mode: block the Link navigation and toggle selection instead
  // In normal mode: let the Link navigate (supports Ctrl+click / middle-click to open in new tab)
  const handleCardClick = (e: React.MouseEvent, playlist: Playlist) => {
    if (selectMode) {
      e.preventDefault();
      toggleSelection(playlist.platformId);
    }
  };

  // Called when the Liked Songs card body is clicked
  // In select mode: block the Link navigation and toggle selection instead
  // In normal mode: let the Link navigate (supports Ctrl+click / middle-click to open in new tab)
  const handleLikedCardClick = (e: React.MouseEvent) => {
    if (selectMode) {
      e.preventDefault();
      toggleSelection(LIKED_SONGS_ID);
    }
  };

  // Split playlists into owned and following groups
  const ownedPlaylists = playlists.filter(p => p.ownerId === getPlatformUserId());
  const followingPlaylists = playlists.filter(p => p.ownerId !== getPlatformUserId());

  // Full Playlist objects for the current selection — passed to MergeModal in Step 2
  // Liked Songs is handled separately since it's not in the playlists array
  const selectedPlaylists = playlists.filter(p => selectedIds.has(p.platformId));
  const likedSongsSelected = selectedIds.has(LIKED_SONGS_ID);

  // Human-readable label for the action bar — includes "Liked Songs" if selected
  const selectedNames = [
    ...(likedSongsSelected ? ['Liked Songs'] : []),
    ...selectedPlaylists.map(p => p.name),
  ].join(', ');

  const isLikedSelected = selectedIds.has(LIKED_SONGS_ID);

  return (
    <div className="bg-bg-primary text-text-primary">
      {/* pb-28 reserves space so the last card row is never hidden behind the fixed action bar */}
      <div className="min-h-screen pb-28">

      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border-color px-4 sm:px-8 py-4 sm:py-6 bg-bg-secondary">
        <div className="flex items-center justify-between">
          {/* ?switchTo encodes the active userId so middle-click / Ctrl+click opens a new
              tab on the correct platform instead of falling back to localStorage. */}
          <Link to={`/dashboard?switchTo=${getUserId()}`} className="flex items-center gap-3 cursor-pointer w-fit">
            <img src="/favicon.svg" alt="TuneCraft icon" className="h-12 w-12" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Tune<span className="text-accent">Craft</span>
              </h1>
              <p className="text-text-muted text-sm mt-0.5">Your music, engineered.</p>
            </div>
          </Link>

          {/* Account switcher button — shows the active platform and opens the sidebar */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-border-color
                       bg-bg-card hover:border-accent/50 hover:bg-bg-secondary
                       transition-all duration-200 hover:scale-105 active:scale-95"
            aria-label="Switch platform account"
          >
            <span className="text-sm font-semibold text-text-primary truncate max-w-[140px]">
              {activeAccount?.displayName || activeAccount?.platform || 'Account'}
            </span>
            {/* Small platform colour dot — uses shared PLATFORM_COLORS, falls back to accent */}
            {activeAccount && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: PLATFORM_COLORS[activeAccount.platform] ?? 'var(--color-accent)',
                }}
              />
            )}
            <span className="text-text-muted text-xs">▼</span>
          </button>
        </div>
      </div>

      {/* Platform Switcher Sidebar */}
      <PlatformSwitcherSidebar
        isOpen={sidebarOpen}
        activeUserId={activeAccount?.userId ?? ''}
        onClose={() => setSidebarOpen(false)}
        onSwitch={handleAccountSwitch}
      />

      <div className="px-4 sm:px-8 py-6 sm:py-10">

        {/* Error state — shown in place of the library when the load fails */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
            <span className="text-5xl">⚠️</span>
            <p className="text-text-primary font-semibold text-lg">Failed to load your library</p>
            <p className="text-text-muted text-sm">{error}</p>
            <button
              onClick={loadLibrary}
              className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-2.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 text-sm mt-2"
            >
              Try again
            </button>
            <Link
              to="/"
              className="text-text-muted hover:text-text-primary text-sm transition-colors"
            >
              ← Back to Login
            </Link>
          </div>
        )}

        {/* Loading state — rendered inside the layout so header and footer stay visible */}
        {loading && (
          <div className="flex items-center justify-center py-40">
            <p className="text-accent text-xl">{loadingLabel}</p>
          </div>
        )}

        {!loading && !error && (
          <>
        {/* Playlist Discovery Search Bar */}
        <div className="mb-8">
          <p className="text-text-muted text-sm mb-3 uppercase tracking-widest font-semibold">
            Discover any playlist
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={discoverInput}
              onChange={e => {
                setDiscoverInput(e.target.value);
                setDiscoverError(null);
              }}
              onKeyDown={e => e.key === 'Enter' && handleDiscover(e.ctrlKey || e.metaKey)}
              aria-label="Discover any playlist"
              placeholder={`Paste a ${PLATFORM_LABELS[activeAccount?.platform ?? ''] ?? 'playlist'} playlist URL or ID...`}
              className="flex-1 bg-bg-card border border-border-color rounded-full px-5 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors duration-200"
            />
            <button
              onClick={e => handleDiscover(e.ctrlKey || e.metaKey)}
              onMouseDown={e => {
                // Middle-click (button 1) — open in new tab, same as a native anchor
                if (e.button === 1) { e.preventDefault(); handleDiscover(true); }
              }}
              disabled={discoverLoading || !discoverInput.trim()}
              className="bg-accent hover:bg-accent-hover w-[130px] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
            >
              {discoverLoading ? discoverLoadingLabel : 'Go'}
            </button>
          </div>
          {discoverError && (
            <p className="text-red-400 text-sm mt-2 ml-2">{discoverError}</p>
          )}
        </div>

        {/* Group 1 — Liked Songs + Owned Playlists */}
        <div className="mb-10">
          <p className="text-text-muted text-sm mb-4 uppercase tracking-widest font-semibold">
            Your Library <span className="text-accent normal-case">· {ownedPlaylists.length + 1}</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

            {/* Liked Songs card — selectable like owned playlists, handled with LIKED_SONGS_ID */}
            <Link
              to={buildPlaylistUrl('liked', { userId: getUserId(), ownerId: getPlatformUserId() ?? '', name: 'Liked Songs', platform: activeAccount?.platform ?? '', trackCount: likedCount })}
              state={{ ownerId: getPlatformUserId(), name: 'Liked Songs', platform: activeAccount?.platform }}
              onClick={handleLikedCardClick}
              className={[
                'group relative bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer block',
                isLikedSelected
                  ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                  : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
              ].join(' ')}
            >
              {/* Checkbox — hover-reveal in normal mode, always visible in select mode */}
              <div
                role="checkbox"
                aria-checked={isLikedSelected}
                aria-label="Select Liked Songs for merge"
                tabIndex={0}
                onClick={e => handleCheckboxClick(e, LIKED_SONGS_ID)}
                onKeyDown={e => e.key === ' ' && handleCheckboxClick(e as any, LIKED_SONGS_ID)}
                className={[
                  'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                  isLikedSelected
                    ? 'bg-accent border-accent opacity-100'
                    : 'bg-black/40 border-white/60',
                  selectMode ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100',
                ].join(' ')}
              >
                {isLikedSelected && <span className="text-white text-xs font-bold leading-none">✓</span>}
              </div>

              <div className="aspect-square w-full bg-gradient-to-br from-purple-900 to-accent/30 flex items-center justify-center">
                <span className="text-8xl">💜</span>
              </div>
              <div className="p-4">
                <p className="font-semibold text-sm">Liked Songs</p>
                <p className="text-text-muted text-xs mt-1">{likedCount ?? '...'} tracks</p>
              </div>
            </Link>

            {/* Owned playlists — hover-reveal checkbox, fully selectable */}
            {ownedPlaylists.map(playlist => {
              const isSelected = selectedIds.has(playlist.platformId);
              return (
                <Link
                  key={playlist.platformId}
                  to={buildPlaylistUrl(playlist.platformId, { userId: getUserId(), ownerId: playlist.ownerId, name: playlist.name, platform: playlist.platform ?? '', trackCount: playlist.trackCount })}
                  state={{ ownerId: playlist.ownerId, name: playlist.name, platform: playlist.platform, trackCount: playlist.trackCount }}
                  onClick={(e) => handleCardClick(e, playlist)}
                  className={[
                    'group relative bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer block',
                    isSelected
                      ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                      : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
                  ].join(' ')}
                >
                  {/* Checkbox — hover-reveal in normal mode, always visible in select mode */}
                  <div
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`Select ${playlist.name} for merge`}
                    tabIndex={0}
                    onClick={e => handleCheckboxClick(e, playlist.platformId)}
                    onKeyDown={e => e.key === ' ' && handleCheckboxClick(e as any, playlist.platformId)}
                    className={[
                      'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                      isSelected
                        ? 'bg-accent border-accent opacity-100'
                        : 'bg-black/40 border-white/60',
                      selectMode ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100',
                    ].join(' ')}
                  >
                    {isSelected && <span className="text-white text-xs font-bold leading-none">✓</span>}
                  </div>

                  <div className="aspect-square w-full bg-bg-secondary overflow-hidden">
                    {playlist.imageUrl ? (
                      <img
                        src={playlist.imageUrl}
                        alt={playlist.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">
                        🎵
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-semibold text-sm truncate">{playlist.name}</p>
                    <p className="text-text-muted text-xs mt-1">{playlist.trackCount} tracks</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Banner — shown when the platform can't list followed playlists at all.
            If the platform allows accessing non-owned playlists by URL (ownershipRestricted
            false), we point the user toward the Discovery bar as a workaround. */}
        {!platformConfig.followedPlaylistsSupported && (
          <div className="mb-10 rounded-2xl border border-border-color bg-bg-card px-5 py-4 flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">ℹ️</span>
            <div>
              <p className="text-sm text-text-primary font-semibold">
                Followed playlists aren't shown
              </p>
              <p className="text-xs text-text-muted mt-1">
                {platformConfig.label}'s official API only returns playlists you own.
                {!platformConfig.ownershipRestricted && (
                  <> You can still access any public playlist by pasting its URL into the search bar above.</>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Group 2 — Following
            On platforms where ownershipRestricted is true (e.g. Spotify), followed playlists
            can't be written to, so in select mode they are dimmed and clicks are blocked.
            On platforms where ownershipRestricted is false the restriction doesn't apply
            and followed playlists behave the same as owned ones in select mode. */}
        {followingPlaylists.length > 0 && (
          <div>
            <p className="text-text-muted text-sm mb-4 uppercase tracking-widest font-semibold">
              Following <span className="text-accent normal-case">· {followingPlaylists.length}</span>
            </p>
            {selectMode && platformConfig.ownershipRestricted && (
              <p className="text-text-muted text-xs mb-3 -mt-2">
                Followed playlists can't be merged — you don't own them.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {followingPlaylists.map(playlist => {
                const isSelected = selectedIds.has(playlist.platformId);
                const selectable = !platformConfig.ownershipRestricted;
                return (
                <Link
                  key={playlist.platformId}
                  to={buildPlaylistUrl(playlist.platformId, { userId: getUserId(), ownerId: playlist.ownerId, name: playlist.name, platform: playlist.platform ?? '', trackCount: playlist.trackCount })}
                  state={{ ownerId: playlist.ownerId, name: playlist.name, platform: playlist.platform, trackCount: playlist.trackCount }}
                  onClick={(e) => {
                    if (selectable) {
                      handleCardClick(e, playlist);
                    } else if (selectMode) {
                      e.preventDefault();
                    }
                  }}
                  className={[
                    'group bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 block',
                    selectable
                      ? [
                          'relative cursor-pointer',
                          isSelected
                            ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                            : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
                        ].join(' ')
                      : [
                          'border-border-color opacity-75',
                          selectMode ? 'opacity-30 cursor-not-allowed' : 'hover:border-accent/50 hover:bg-bg-secondary cursor-pointer',
                        ].join(' '),
                  ].join(' ')}
                >
                  <div className="aspect-square w-full bg-bg-secondary overflow-hidden relative">
                    {/* "Following" badge — left side to mirror owned card's checkbox position */}
                    <div className="absolute left-2 top-2 z-10 pointer-events-none">
                      <div className="bg-bg-card text-accent text-[11px] font-semibold px-2.5 py-1 rounded-md shadow-lg">
                        Following
                      </div>
                    </div>
                    {/* Checkbox — right side, matching owned card layout */}
                    {selectable && (
                      <div
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Select ${playlist.name} for merge`}
                        tabIndex={0}
                        onClick={e => handleCheckboxClick(e, playlist.platformId)}
                        onKeyDown={e => e.key === ' ' && handleCheckboxClick(e as any, playlist.platformId)}
                        className={[
                          'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                          isSelected
                            ? 'bg-accent border-accent opacity-100'
                            : 'bg-black/40 border-white/60',
                          selectMode ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100',
                        ].join(' ')}
                      >
                        {isSelected && <span className="text-white text-xs font-bold leading-none">✓</span>}
                      </div>
                    )}
                    {playlist.imageUrl ? (
                      <img
                        src={playlist.imageUrl}
                        alt={playlist.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">
                        🎵
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-semibold text-sm truncate">{playlist.name}</p>
                    <p className="text-text-muted text-xs mt-1">{playlist.trackCount} tracks</p>
                  </div>
                </Link>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Bottom Action Bar
          Fixed to the bottom — appears once 2+ items are selected (owned playlists and/or Liked Songs).
          Cancel clears everything and exits select mode. */}
      {selectMode && selectedIds.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-card border-t border-border-color px-4 sm:px-8 py-3 sm:py-5 flex items-center justify-between gap-3 z-40 shadow-2xl">
          <div>
            <p className="text-text-primary font-semibold">
              {selectedIds.size} playlists selected
            </p>
            <p className="hidden sm:block text-text-muted text-xs mt-0.5 truncate max-w-xs">
              {selectedNames}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={exitSelectMode}
              className="bg-bg-secondary hover:bg-bg-primary text-text-muted font-semibold px-5 py-2.5 rounded-full border border-border-color transition-all duration-200 text-sm"
            >
              Cancel
            </button>
            {/* Merge button — will open MergeModal in Step 2 */}
            <button
              onClick={() => setMergeModalOpen(true)}
              className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-2.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 text-sm"
            >
              🔀 Merge {selectedIds.size} Playlists
            </button>
          </div>
        </div>
      )}
      {/* Merge modal — opened from the bottom action bar once 2+ playlists are selected */}
      <MergeModal
        isOpen={mergeModalOpen}
        selectedPlaylists={selectedPlaylists}
        likedSongsSelected={likedSongsSelected}
        likedCount={likedCount}
        isLoading={mergeLoading}
        onClose={() => setMergeModalOpen(false)}
        onConfirm={handleMerge}
      />

      {/* Success toast */}
      {mergeSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-3 rounded-full shadow-lg z-50">
          ✅ {mergeSuccess}
        </div>
      )}

      {/* Error toast */}
      {mergeError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-lg z-50 text-center max-w-md">
          ⚠️ {mergeError}
        </div>
      )}

      </div>

      {/* Footer sits outside the pb-28 content div so it renders at the true page bottom */}
      <AppFooter />
    </div>
  );
}