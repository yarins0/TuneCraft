import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/platform/registry', () => ({
  getAdapter: vi.fn(),
}));

import { getAdapter } from '../src/lib/platform/registry';
import { discoverById } from '../src/controllers/discover';

const mockGetAdapter = vi.mocked(getAdapter);

const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    params:       { playlistId: 'playlist-1' },
    query:        {},
    accessToken:  'token-123',
    userPlatform: 'SPOTIFY',
    ...overrides,
  } as any);

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json:   vi.fn(),
} as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discoverById', () => {
  it('returns 404 when the platform adapter throws with status 404', async () => {
    mockGetAdapter.mockReturnValue({
      platform: 'SPOTIFY',
      fetchPlaylist: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    } as any);

    const res = makeRes();
    await discoverById(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Playlist not found' });
  });

  it('returns 403 when the platform adapter throws with status 403', async () => {
    mockGetAdapter.mockReturnValue({
      platform: 'SPOTIFY',
      fetchPlaylist: vi.fn().mockRejectedValue({ response: { status: 403 } }),
    } as any);

    const res = makeRes();
    await discoverById(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'This playlist is private' });
  });

  it('returns all PlatformPlaylist fields shaped into the discovery response on success', async () => {
    const platformPlaylist = {
      id:         'pl-abc',
      name:       'Weekend Vibes',
      ownerId:    'owner-xyz',
      trackCount: 42,
      imageUrl:   'https://example.com/cover.jpg',
    };
    mockGetAdapter.mockReturnValue({
      platform: 'SPOTIFY',
      fetchPlaylist: vi.fn().mockResolvedValue(platformPlaylist),
    } as any);

    const res = makeRes();
    await discoverById(makeReq(), res);

    // formatPlaylistResponse maps id → platformId and attaches the platform string
    expect(res.json).toHaveBeenCalledWith({
      platformId: 'pl-abc',
      name:       'Weekend Vibes',
      ownerId:    'owner-xyz',
      trackCount: 42,
      imageUrl:   'https://example.com/cover.jpg',
      platform:   'SPOTIFY',
    });
  });
});
