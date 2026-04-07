import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../api/playlists', () => ({
  savePlaylist:  vi.fn(),
  copyPlaylist:  vi.fn(),
  splitPlaylist: vi.fn(),
}));

vi.mock('../utils/accounts', () => ({
  getActiveAccount: vi.fn(() => ({ userId: 'user-1' })),
  getAuthHeaders:   vi.fn(() => ({})),
}));

import { savePlaylist } from '../api/playlists';
import { usePlaylistActions } from '../hooks/usePlaylistActions';
import type { Track } from '../api/tracks';

const mockSavePlaylist = vi.mocked(savePlaylist);

const makeTrack = (id: string): Track => ({
  id,
  name:          `Track ${id}`,
  artist:        'Test Artist',
  albumName:     'Test Album',
  albumImageUrl: null,
  durationMs:    180000,
  releaseYear:   2020,
  genres:        [],
  audioFeatures: {
    energy: null, danceability: null, valence: null,
    acousticness: null, instrumentalness: null, speechiness: null, tempo: null,
  },
});

// Renders the hook wired up to a real useState so track mutations are reflected
const renderWithTracks = (initialTracks: Track[]) =>
  renderHook(() => {
    const [tracks, setTracks] = useState<Track[]>(initialTracks);
    const actions = usePlaylistActions({
      playlistId:           'playlist-1',
      name:                 'Test Playlist',
      tracks,
      setTracks,
      reshuffleSchedule:    null,
      setReshuffleSchedule: vi.fn(),
      onShuffleApplied:     vi.fn(),
      onCopyComplete:       vi.fn(),
      onSplitComplete:      vi.fn(),
      onSuccess:            vi.fn(),
      onError:              vi.fn(),
    });
    return { tracks, actions };
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePlaylistActions', () => {
  describe('handleSave', () => {
    it('is a no-op when hasUnsavedChanges is false', async () => {
      const { result } = renderWithTracks([makeTrack('t1')]);

      await act(async () => {
        await result.current.actions.handleSave();
      });

      expect(mockSavePlaylist).not.toHaveBeenCalled();
    });

    it('sets isSaveLoading to true while the save is in progress', async () => {
      let resolveSave!: () => void;
      mockSavePlaylist.mockReturnValueOnce(
        new Promise<void>(resolve => { resolveSave = resolve; })
      );

      const { result } = renderWithTracks([makeTrack('t1'), makeTrack('t2')]);

      // Mark dirty so handleSave doesn't short-circuit
      act(() => { result.current.actions.reorderTracks(0, 1); });

      // Start the save without awaiting it so we can observe the in-progress state
      act(() => { void result.current.actions.handleSave(); });

      expect(result.current.actions.isSaveLoading).toBe(true);

      // Complete the save and verify the flag resets
      await act(async () => {
        resolveSave();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.actions.isSaveLoading).toBe(false);
    });
  });

  describe('undoChanges', () => {
    it('restores the original track order', () => {
      const initial = [makeTrack('t1'), makeTrack('t2'), makeTrack('t3')];
      const { result } = renderWithTracks(initial);

      // Move t1 from index 0 to index 2 → [t2, t3, t1]
      act(() => { result.current.actions.reorderTracks(0, 2); });
      expect(result.current.tracks.map(t => t.id)).toEqual(['t2', 't3', 't1']);

      // Undo should restore the original [t1, t2, t3]
      act(() => { result.current.actions.undoChanges(); });
      expect(result.current.tracks.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    });

    it('clears hasUnsavedChanges after undo', () => {
      const { result } = renderWithTracks([makeTrack('t1'), makeTrack('t2')]);

      act(() => { result.current.actions.reorderTracks(0, 1); });
      expect(result.current.actions.hasUnsavedChanges).toBe(true);

      act(() => { result.current.actions.undoChanges(); });
      expect(result.current.actions.hasUnsavedChanges).toBe(false);
    });
  });
});
