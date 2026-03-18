import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPlaylists, fetchLikedSongs } from '../api/playlists';
import type { Playlist } from '../api/playlists';
import { extractPlaylistId } from '../utils/platform';
import { discoverPlaylist } from '../api/playlists';
import MergeModal from '../components/MergeModal';
import { mergePlaylist } from '../api/playlists';
import { buildMergedTrackList } from '../utils/mergePlaylists';

const getUserId = () => sessionStorage.getItem('userId') || '';
const getPlatformUserId = () => sessionStorage.getItem('platformUserId');

// Sentinel ID used to represent Liked Songs in the selection set
// Liked Songs have no real Spotify playlist ID, so we use this constant as a stand-in
// The backend merge handler will detect this value and fetch /me/tracks instead of /playlists/:id/items
const LIKED_SONGS_ID = 'liked';

export default function Dashboard() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedCount, setLikedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discoverInput, setDiscoverInput] = useState('');
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // --- Phase 5: Merge modal state ---
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // --- Phase 5: Multi-select state ---
  // selectMode becomes true the moment the user checks any playlist
  const [selectMode, setSelectMode] = useState(false);
  // selectedIds holds spotifyIds of checked owned playlists, plus LIKED_SONGS_ID if Liked Songs is checked
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  useEffect(() => {
    const userId = getUserId();

    if (!userId) {
      setError('No user session found. Please log in again.');
      setLoading(false);
      return;
    }

    // Fetch both playlists and liked songs count in parallel
    Promise.all([
      fetchPlaylists(userId),
      fetchLikedSongs(userId),
    ])
      .then(([playlistData, likedData]) => {
        setPlaylists(playlistData);
        setLikedCount(likedData.trackCount);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load playlists');
        setLoading(false);
      });
  }, []);

  // Handles the discover form submission
  // Parses the input, fetches playlist metadata, then navigates to the detail page
  const handleDiscover = async () => {
    setDiscoverError(null);
    const playlistId = extractPlaylistId(discoverInput);

    if (!playlistId) {
      setDiscoverError('Please enter a valid Spotify playlist URL or ID');
      return;
    }

    setDiscoverLoading(true);

    try {
      const playlist = await discoverPlaylist(getUserId(), playlistId);
      navigate(`/playlist/${playlist.spotifyId}`, {
        state: { ownerId: playlist.ownerId, name: playlist.name },
      });
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
        ...selectedPlaylists.map(p => p.spotifyId),
      ];

      const tracks = await buildMergedTrackList(getUserId(), playlistIds, removeDuplicates);
      const { playlist: newPlaylist } = await mergePlaylist(getUserId(), tracks, name);

      setMergeModalOpen(false);
      exitSelectMode();

      // Navigate to the newly created playlist so the user can see the result immediately
      navigate(`/playlist/${newPlaylist.spotifyId}`, {
        state: { ownerId: newPlaylist.ownerId, name: newPlaylist.name },
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
    e.stopPropagation();
    if (!selectMode) setSelectMode(true);
    toggleSelection(id);
  };

  // Called when the card body itself is clicked
  // In select mode: toggle selection; in normal mode: navigate
  const handleCardClick = (playlist: Playlist) => {
    if (selectMode) {
      toggleSelection(playlist.spotifyId);
    } else {
      navigate(`/playlist/${playlist.spotifyId}`, {
        state: { ownerId: playlist.ownerId, name: playlist.name },
      });
    }
  };

  // Called when the Liked Songs card body is clicked
  // In select mode: toggle its selection; in normal mode: navigate as before
  const handleLikedCardClick = () => {
    if (selectMode) {
      toggleSelection(LIKED_SONGS_ID);
    } else {
      navigate('/playlist/liked', {
        state: { ownerId: getPlatformUserId(), name: 'Liked Songs' },
      });
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading your music...</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-red-400 text-xl">{error}</div>
    </div>
  );

  // Split playlists into owned and following groups
  const ownedPlaylists = playlists.filter(p => p.ownerId === getPlatformUserId());
  const followingPlaylists = playlists.filter(p => p.ownerId !== getPlatformUserId());

  // Full Playlist objects for the current selection — passed to MergeModal in Step 2
  // Liked Songs is handled separately since it's not in the playlists array
  const selectedPlaylists = playlists.filter(p => selectedIds.has(p.spotifyId));
  const likedSongsSelected = selectedIds.has(LIKED_SONGS_ID);

  // Human-readable label for the action bar — includes "Liked Songs" if selected
  const selectedNames = [
    ...(likedSongsSelected ? ['Liked Songs'] : []),
    ...selectedPlaylists.map(p => p.name),
  ].join(', ');

  const isLikedSelected = selectedIds.has(LIKED_SONGS_ID);

  return (
    // pb-28 reserves space so the last card row is never hidden behind the fixed action bar
    <div className="min-h-screen bg-bg-primary text-text-primary pb-28">

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border-color px-8 py-6 bg-bg-secondary">
        <div className="flex items-center gap-3 cursor-pointer w-fit" onClick={() => navigate('/dashboard')}>
          <img src="/favicon.svg" alt="TuneCraft icon" className="h-12 w-12" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Tune<span className="text-accent">Craft</span>
            </h1>
            <p className="text-text-muted text-sm mt-0.5">Your music, engineered.</p>
          </div>
        </div>
      </div>

      <div className="px-8 py-10">
        {/* Playlist Discovery Search Bar — unchanged */}
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
              onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              placeholder="Paste a Spotify playlist URL or ID..."
              className="flex-1 bg-bg-card border border-border-color rounded-full px-5 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors duration-200"
            />
            <button
              onClick={handleDiscover}
              disabled={discoverLoading || !discoverInput.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
            >
              {discoverLoading ? 'Loading...' : 'Go'}
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
            <div
              onClick={handleLikedCardClick}
              className={[
                'group relative bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer',
                isLikedSelected
                  ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                  : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
              ].join(' ')}
            >
              {/* Checkbox — hover-reveal in normal mode, always visible in select mode */}
              <div
                onClick={e => handleCheckboxClick(e, LIKED_SONGS_ID)}
                className={[
                  'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                  isLikedSelected
                    ? 'bg-accent border-accent opacity-100'
                    : 'bg-black/40 border-white/60',
                  selectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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
            </div>

            {/* Owned playlists — hover-reveal checkbox, fully selectable */}
            {ownedPlaylists.map(playlist => {
              const isSelected = selectedIds.has(playlist.spotifyId);
              return (
                <div
                  key={playlist.spotifyId}
                  onClick={() => handleCardClick(playlist)}
                  className={[
                    'group relative bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer',
                    isSelected
                      ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                      : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
                  ].join(' ')}
                >
                  {/* Checkbox — hover-reveal in normal mode, always visible in select mode */}
                  <div
                    onClick={e => handleCheckboxClick(e, playlist.spotifyId)}
                    className={[
                      'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                      isSelected
                        ? 'bg-accent border-accent opacity-100'
                        : 'bg-black/40 border-white/60',
                      selectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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
                </div>
              );
            })}
          </div>
        </div>

        {/* Group 2 — Following
            In select mode: dimmed and clicks are blocked — these playlists aren't owned by the user
            and cannot be written to, so they can't participate in a merge */}
        {followingPlaylists.length > 0 && (
          <div>
            <p className="text-text-muted text-sm mb-4 uppercase tracking-widest font-semibold">
              Following <span className="text-accent normal-case">· {followingPlaylists.length}</span>
            </p>
            {selectMode && (
              <p className="text-text-muted text-xs mb-3 -mt-2">
                Followed playlists can't be merged — you don't own them.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {followingPlaylists.map(playlist => (
                <div
                  key={playlist.spotifyId}
                  onClick={() => {
                    if (!selectMode) {
                      navigate(`/playlist/${playlist.spotifyId}`, {
                        state: { ownerId: playlist.ownerId, name: playlist.name },
                      });
                    }
                  }}
                  className={[
                    'group bg-bg-card rounded-2xl overflow-hidden border border-border-color transition-all duration-300 opacity-75',
                    selectMode
                      // In select mode: dim and show a not-allowed cursor, but keep hover feedback consistent
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:border-accent/50 hover:bg-bg-secondary cursor-pointer',
                  ].join(' ')}
                >
                  <div className="aspect-square w-full bg-bg-secondary overflow-hidden relative">
                    <div className="absolute right-2 top-2 z-10 pointer-events-none">
                      <div className="bg-bg-card text-accent text-[11px] font-semibold px-2.5 py-1 rounded-md shadow-lg">
                        Following
                      </div>
                    </div>
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
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar
          Fixed to the bottom — appears once 2+ items are selected (owned playlists and/or Liked Songs).
          Cancel clears everything and exits select mode. */}
      {selectMode && selectedIds.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-card border-t border-border-color px-8 py-5 flex items-center justify-between z-40 shadow-2xl">
          <div>
            <p className="text-text-primary font-semibold">
              {selectedIds.size} playlists selected
            </p>
            <p className="text-text-muted text-xs mt-0.5 truncate max-w-xs">
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
  );
}