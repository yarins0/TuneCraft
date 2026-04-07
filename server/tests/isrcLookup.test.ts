import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios before importing the module under test so the direct axios.get call
// in lookupViaMusicBrainz is intercepted at module load time.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isCancel: vi.fn(() => false),
  },
}));

// Mock requestWithRetry to intercept the Spotify fallback path without running
// the real retry logic or making actual network calls.
vi.mock('../src/lib/requestWithRetry', () => ({
  requestWithRetry: vi.fn(),
}));

import axios from 'axios';
import { requestWithRetry } from '../src/lib/requestWithRetry';
import { isrcLookup } from '../src/lib/isrcLookup';

const mockAxiosGet = vi.mocked(axios.get);
const mockRequestWithRetry = vi.mocked(requestWithRetry);

// Helper: makes requestWithRetry respond correctly whether or not the token
// cache is already populated from a previous test in the same process.
const stubSpotifyFallback = (trackId: string | null) => {
  mockRequestWithRetry.mockImplementation((_method, url) => {
    if (typeof url === 'string' && url.includes('/api/token')) {
      return Promise.resolve({ data: { access_token: 'stub-token', expires_in: 3600 } });
    }
    const items = trackId ? [{ id: trackId }] : [];
    return Promise.resolve({ data: { tracks: { items } } });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isrcLookup', () => {
  it('returns the Spotify track ID extracted from a MusicBrainz URL relation', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        recordings: [
          {
            relations: [
              { url: { resource: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' } },
            ],
          },
        ],
      },
    });

    const result = await isrcLookup('USRC12345678');
    expect(result).toBe('4uLU6hMCjMI75M1A2tKUQC');
  });

  it('falls through to the Spotify fallback when MusicBrainz returns 404', async () => {
    // MusicBrainz 404 is treated as a soft miss — returns null, then Spotify is tried.
    mockAxiosGet.mockRejectedValueOnce({ response: { status: 404 } });
    stubSpotifyFallback('spotify-track-id-abc');

    const result = await isrcLookup('USRC12345678');
    expect(result).toBe('spotify-track-id-abc');
  });

  it('returns null when MusicBrainz returns no recordings and Spotify returns no items', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { recordings: [] } });
    stubSpotifyFallback(null);

    const result = await isrcLookup('USRC12345678');
    expect(result).toBeNull();
  });

  it('returns null for an empty or missing ISRC', async () => {
    expect(await isrcLookup(null)).toBeNull();
    expect(await isrcLookup(undefined)).toBeNull();
    expect(await isrcLookup('   ')).toBeNull();
    // No network calls should have been made
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });
});
