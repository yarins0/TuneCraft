import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/platform/registry', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  default: {
    playlist: {
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/playlistHelpers', () => ({
  calculateAverages: vi.fn(() => ({})),
  enqueueWrite: vi.fn(),
}));

import { getAdapter } from '../src/lib/platform/registry';
import { getTracks, shuffleTracks } from '../src/controllers/tracks';

const mockGetAdapter = vi.mocked(getAdapter);

// Minimal Express-like mock objects used across tests
const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    params:      { userId: 'user-1', playlistId: 'playlist-1' },
    query:       { page: '0' },
    body:        {},
    accessToken: 'token-123',
    userPlatform: 'SPOTIFY',
    on:          vi.fn(),
    ...overrides,
  } as any);

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json:   vi.fn(),
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  // Default adapter: returns an empty track page so the happy-path code path runs
  mockGetAdapter.mockReturnValue({
    platform: 'SPOTIFY',
    fetchPlaylistTracks: vi.fn().mockResolvedValue({ tracks: [], total: 0 }),
    replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
  } as any);
});

describe('getTracks', () => {
  it('clamps ?page=9999 to MAX_PAGE_BOUND (1000) before forwarding to the adapter', async () => {
    const req = makeReq({ query: { page: '9999' } });
    const res = makeRes();

    await getTracks(req, res);

    const adapter = mockGetAdapter.mock.results[0].value;
    expect(adapter.fetchPlaylistTracks).toHaveBeenCalledWith(
      'token-123',
      'playlist-1',
      1000,
      expect.any(AbortSignal)
    );
  });

  it('returns page 0 when ?page is missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();

    await getTracks(req, res);

    const adapter = mockGetAdapter.mock.results[0].value;
    expect(adapter.fetchPlaylistTracks).toHaveBeenCalledWith(
      'token-123',
      'playlist-1',
      0,
      expect.any(AbortSignal)
    );
  });
});

describe('shuffleTracks', () => {
  it('returns 400 when the request body is missing a tracks array', async () => {
    const req = makeReq({ body: {} }); // no tracks property
    const res = makeRes();

    await shuffleTracks(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tracks must be an array' });
  });

  it('returns 400 when tracks is present but not an array', async () => {
    const req = makeReq({ body: { tracks: 'not-an-array' } });
    const res = makeRes();

    await shuffleTracks(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tracks must be an array' });
  });
});
