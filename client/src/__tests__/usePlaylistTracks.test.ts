import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../api/tracks', () => ({
  fetchTracksPage:      vi.fn(),
  fetchPendingFeatures: vi.fn(),
  fetchPendingGenres:   vi.fn(),
}));

vi.mock('../utils/accounts', () => ({
  getActiveAccount: vi.fn(() => ({ userId: 'user-1' })),
  getAuthHeaders:   vi.fn(() => ({})),
}));

import {
  fetchTracksPage,
  fetchPendingFeatures,
  fetchPendingGenres,
} from '../api/tracks';
import { usePlaylistTracks } from '../hooks/usePlaylistTracks';

const mockFetchTracksPage      = vi.mocked(fetchTracksPage);
const mockFetchPendingFeatures = vi.mocked(fetchPendingFeatures);
const mockFetchPendingGenres   = vi.mocked(fetchPendingGenres);

const nullFeatures = {
  energy: null, danceability: null, valence: null,
  acousticness: null, instrumentalness: null, speechiness: null, tempo: null,
};

const makeTrack = (id: string, artist = 'Artist') => ({
  id,
  name:          `Track ${id}`,
  artist,
  albumName:     '',
  albumImageUrl: null,
  durationMs:    180000,
  releaseYear:   2020,
  genres:        [],
  audioFeatures: { ...nullFeatures },
});

const makePageResponse = (tracks: ReturnType<typeof makeTrack>[], hasMore = false) => ({
  tracks,
  playlistAverages: { ...nullFeatures },
  total:    tracks.length,
  hasMore,
  nextPage: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both polling endpoints return empty so polling runs without side effects
  mockFetchPendingFeatures.mockResolvedValue({ features: {} });
  mockFetchPendingGenres.mockResolvedValue({ genres: {} });
});

afterEach(() => {
  // Restore real timers in case a test used fake timers
  vi.useRealTimers();
});

describe('usePlaylistTracks', () => {
  it('does not set error state when the first-page fetch is aborted (navigation away)', async () => {
    // AbortError is the signal that the user navigated before the fetch completed.
    // The hook must swallow it silently — no error state, no isLoading=false.
    mockFetchTracksPage.mockRejectedValueOnce(
      new DOMException('The user aborted a request.', 'AbortError')
    );

    const { result } = renderHook(() => usePlaylistTracks('playlist-1', vi.fn()));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    // isLoading is never reset for an abort — the component will unmount on navigation
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isLoading to false and populates tracks after a successful first-page fetch', async () => {
    const tracks = [makeTrack('t1'), makeTrack('t2')];
    mockFetchTracksPage.mockResolvedValueOnce(makePageResponse(tracks));

    const { result } = renderHook(() => usePlaylistTracks('playlist-1', vi.fn()));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tracks).toHaveLength(2);
    expect(result.current.tracks[0].id).toBe('t1');
    expect(result.current.error).toBeNull();
  });

  it('stops feature polling after MAX_EMPTY_POLLS (30) consecutive empty responses', async () => {
    vi.useFakeTimers();

    // Track with all-null features causes scheduleFeaturePolling to start an interval
    const track = makeTrack('t1');
    mockFetchTracksPage.mockResolvedValueOnce(makePageResponse([track]));
    // fetchPendingFeatures always returns empty — simulates features never arriving

    renderHook(() => usePlaylistTracks('playlist-1', vi.fn()));

    // Flush the async IIFE so the feature polling interval is registered
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Trigger exactly 30 one-second ticks — each returns an empty features response
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
        // Allow the async interval callback to complete (one microtask round per await)
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    const callsAfterThirty = mockFetchPendingFeatures.mock.calls.length;
    expect(callsAfterThirty).toBe(30);

    // Advancing more time should produce zero additional calls — interval is cleared
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockFetchPendingFeatures.mock.calls.length).toBe(30);
  });
});
