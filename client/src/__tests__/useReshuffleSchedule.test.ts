import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../api/reshuffle', () => ({
  fetchReshuffleSchedule: vi.fn(),
  enableReshuffle:        vi.fn(),
  disableReshuffle:       vi.fn(),
}));

vi.mock('../utils/accounts', () => ({
  getActiveAccount:  vi.fn(() => ({ userId: 'user-1' })),
  getAuthHeaders:    vi.fn(() => ({})),
}));

import { fetchReshuffleSchedule } from '../api/reshuffle';
import { useReshuffleSchedule } from '../hooks/useReshuffleSchedule';
import type { ReshuffleSchedule } from '../api/reshuffle';

const mockFetchReshuffleSchedule = vi.mocked(fetchReshuffleSchedule);

const defaultOptions = {
  playlistId: 'playlist-1',
  isOwner:    true,
  name:       'My Playlist',
  platform:   'SPOTIFY',
  onSuccess:  vi.fn(),
  onError:    vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useReshuffleSchedule', () => {
  it('populates reshuffleSchedule and pre-fills inputs from a successful fetch', async () => {
    const schedule: ReshuffleSchedule = {
      intervalDays: 14,
      algorithms: {
        trueRandom:    true,
        artistSpread:  false,
        genreSpread:   false,
        chronological: false,
      },
    } as any;
    mockFetchReshuffleSchedule.mockResolvedValueOnce(schedule);

    const { result } = renderHook(() => useReshuffleSchedule(defaultOptions));

    await waitFor(() => {
      expect(result.current.reshuffleSchedule).toEqual(schedule);
    });

    expect(result.current.reshuffleInterval).toBe(14);
    expect(result.current.reshuffleAlgorithms.trueRandom).toBe(true);
    expect(result.current.reshuffleAlgorithms.artistSpread).toBe(false);
  });

  it('leaves all state at defaults when the fetch throws (silent failure)', async () => {
    mockFetchReshuffleSchedule.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useReshuffleSchedule(defaultOptions));

    // Wait for the effect's async function to finish
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reshuffleSchedule).toBeNull();
    expect(result.current.reshuffleInterval).toBe(7);
    expect(result.current.reshuffleAlgorithms).toEqual({
      trueRandom:    false,
      artistSpread:  true,
      genreSpread:   false,
      chronological: false,
    });
  });

  it('does not fetch when the playlist is the Liked Songs virtual list', async () => {
    renderHook(() =>
      useReshuffleSchedule({ ...defaultOptions, playlistId: 'liked' })
    );

    await act(async () => { await Promise.resolve(); });

    expect(mockFetchReshuffleSchedule).not.toHaveBeenCalled();
  });

  it('does not fetch when isOwner is false', async () => {
    renderHook(() =>
      useReshuffleSchedule({ ...defaultOptions, isOwner: false })
    );

    await act(async () => { await Promise.resolve(); });

    expect(mockFetchReshuffleSchedule).not.toHaveBeenCalled();
  });
});
