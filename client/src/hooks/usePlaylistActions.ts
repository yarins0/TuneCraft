import { useState } from 'react';
import type { Track } from '../api/tracks';
import { applyShuffle } from '../utils/shuffleAlgorithms';
import { savePlaylist, copyPlaylist, splitPlaylist } from '../api/playlists';
import type { SplitGroup } from '../utils/splitPlaylist';
import { findDuplicates } from '../utils/findDuplicates';
import type { ReshuffleSchedule } from '../api/reshuffle';

const getUserId = () => localStorage.getItem('userId') || '';

interface Options {
  playlistId: string | undefined;
  name: string | undefined;
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  reshuffleSchedule: ReshuffleSchedule | null;
  setReshuffleSchedule: React.Dispatch<React.SetStateAction<ReshuffleSchedule | null>>;
  // Called after a shuffle so the parent can close the ShuffleModal and reset open row state
  onShuffleApplied: () => void;
  onSuccess: (msg: string, durationMs?: number) => void;
  onError: (msg: string, durationMs?: number) => void;
}

export interface UsePlaylistActionsResult {
  hasUnsavedChanges: boolean;
  saveLoading: boolean;
  splitLoading: boolean;
  handleShuffle: (algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }) => void;
  reorderTracks: (fromIndex: number, toIndex: number) => void;
  handleRemoveDuplicate: (index: number) => void;
  handleRemoveAllDuplicates: () => void;
  handleSave: () => Promise<void>;
  handleConfirmCopy: (copyName: string) => Promise<void>;
  handleConfirmSplit: (groups: SplitGroup[]) => Promise<void>;
  undoChanges: () => void;
}

// Owns all track-editing and playlist-persistence logic for the PlaylistDetail page.
//
// Track editing (in-memory, no API):
//   handleShuffle, reorderTracks, handleRemoveDuplicate, handleRemoveAllDuplicates, undoChanges
//
// Playlist persistence (API calls):
//   handleSave, handleConfirmCopy, handleConfirmSplit
//
// Uses onSuccess/onError callbacks to feed the shared toast system in the parent.
// Uses onShuffleApplied to let the parent close its ShuffleModal and clear open rows.
export const usePlaylistActions = ({
  playlistId,
  name,
  tracks,
  setTracks,
  reshuffleSchedule,
  setReshuffleSchedule,
  onShuffleApplied,
  onSuccess,
  onError,
}: Options): UsePlaylistActionsResult => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalTracks, setOriginalTracks] = useState<Track[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [splitLoading, setSplitLoading] = useState(false);

  // Saves the pre-shuffle snapshot on first edit so the user can undo back to the original order
  const markDirty = () => {
    if (!hasUnsavedChanges) setOriginalTracks([...tracks]);
    setHasUnsavedChanges(true);
  };

  const undoChanges = () => {
    setTracks(originalTracks);
    setHasUnsavedChanges(false);
  };

  // Applies the chosen shuffle algorithms to the current track list in memory.
  // Calls onShuffleApplied so the parent can close the modal and reset open track rows.
  const handleShuffle = (algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }) => {
    markDirty();
    setTracks(applyShuffle(tracks, algorithms));
    onShuffleApplied();
  };

  const reorderTracks = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    markDirty();
    setTracks(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleRemoveDuplicate = (index: number) => {
    markDirty();
    setTracks(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveAllDuplicates = () => {
    markDirty();
    const indexesToRemove = new Set(findDuplicates(tracks).map(d => d.index));
    setTracks(prev => prev.filter((_, i) => !indexesToRemove.has(i)));
  };

  // Writes the current track order to the platform.
  // If auto-reshuffle is active, mirrors the timestamp update the server makes so the
  // ShuffleModal shows the correct next-reshuffle date without requiring a page reload.
  const handleSave = async () => {
    if (!playlistId) return;
    setSaveLoading(true);

    try {
      await savePlaylist(getUserId(), playlistId, tracks);
      setHasUnsavedChanges(false);
      onSuccess('Playlist saved successfully!');

      if (reshuffleSchedule?.intervalDays) {
        const now = new Date();
        const nextReshuffleAt = new Date(now);
        nextReshuffleAt.setDate(nextReshuffleAt.getDate() + reshuffleSchedule.intervalDays);
        setReshuffleSchedule(prev =>
          prev
            ? { ...prev, lastReshuffledAt: now.toISOString(), nextReshuffleAt: nextReshuffleAt.toISOString() }
            : null
        );
      }
    } catch {
      onError(
        'Failed to save — please try again.',
        5000
      );
    } finally {
      setSaveLoading(false);
    }
  };

  // Creates a new playlist as a copy, then opens it in a new tab.
  // ownerId and name are passed as query params because React Router location.state
  // does not survive across new tab opens.
  const handleConfirmCopy = async (copyName: string) => {
    setSaveLoading(true);

    try {
      const { playlist: newPlaylist } = await copyPlaylist(
        getUserId(),
        tracks.map(t => ({ id: t.id })),
        copyName
      );
      setHasUnsavedChanges(false);
      onSuccess('Copy saved to your library!');

      const params = new URLSearchParams({
        name: newPlaylist.name,
        ownerId: newPlaylist.ownerId,
      });
      window.open(`/playlist/${newPlaylist.platformId}?${params}`, '_blank');
    } catch {
      onError(
        'Failed to save — please try again.',
        5000
      );
    } finally {
      setSaveLoading(false);
    }
  };

  // Sends pre-grouped tracks to the backend, which creates one playlist per group.
  const handleConfirmSplit = async (groups: SplitGroup[]) => {
    setSplitLoading(true);

    try {
      const payload = groups.map(g => ({
        name: g.name,
        tracks: g.tracks.map(t => ({ id: t.id })),
        description: g.description ?? '',
      }));

      await splitPlaylist(getUserId(), payload);
      onSuccess(`Split into ${groups.length} playlists — check your library!`, 5000);
    } catch {
      onError('Failed to split playlist. Please try again.', 5000);
    } finally {
      setSplitLoading(false);
    }
  };

  return {
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
  };
};
