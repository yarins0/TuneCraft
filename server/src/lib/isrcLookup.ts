import axios from 'axios';
import { requestWithRetry } from './requestWithRetry';

// ─── MusicBrainz lookup ───────────────────────────────────────────────────────
//
// Primary ISRC resolution path. Free, no auth, 1 req/sec rate limit.
// MusicBrainz stores Spotify track URLs as URL relations on recordings.
//
// Limitation: community-maintained database. Brand-new or niche releases
// may not appear for days or weeks after commercial release.
//
// Required User-Agent header — requests without one are deprioritised.
const MB_USER_AGENT = 'TuneCraft/1.0 (https://github.com/tunecraft)';

const lookupViaMusicBrainz = async (isrc: string): Promise<string | null> => {
  try {
    // `inc=url-rels` embeds all URL relationships on each recording in a single request,
    // which is how we get the associated Spotify track URL.
    const response = await axios.get(
      `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}`,
      {
        params: { inc: 'url-rels', fmt: 'json' },
        headers: { 'User-Agent': MB_USER_AGENT },
        timeout: 10_000,
      }
    );

    const recordings: any[] = response.data?.recordings ?? [];
    for (const recording of recordings) {
      for (const rel of (recording.relations ?? []) as any[]) {
        const resource: string = rel.url?.resource ?? '';
        // Spotify track URLs: https://open.spotify.com/track/{22-char-id}
        const match = resource.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
        if (match) return match[1];
      }
    }
    return null;
  } catch (error: any) {
    // 404 = MusicBrainz doesn't know this ISRC — a normal soft miss, not an error
    if (error.response?.status === 404) return null;
    // Any other error is logged but treated as a miss so enrichment continues
    console.warn(`MusicBrainz ISRC lookup failed for ${isrc}:`, error.response?.status ?? error.message);
    return null;
  }
};

// ─── Spotify client-credentials fallback ─────────────────────────────────────
//
// Secondary ISRC resolution path — used only when MusicBrainz returns null.
// Spotify search knows about new commercial releases immediately (unlike MusicBrainz),
// making it the right fallback for brand-new or niche tracks.
//
// Why not primary:
//   Spotify's client credentials search endpoint rate-limits aggressively.
//   A burst of concurrent requests triggers Retry-After: 120s.
//   By routing most lookups through MusicBrainz first, Spotify is only
//   called for genuine misses — typically a small fraction of a playlist.
//
// Token cache — good for 3600s, refreshed 60s early to avoid mid-request expiry.
let tokenCache: { value: string; expiresAt: Date } | null = null;

const getClientCredentialsToken = async (): Promise<string> => {
  if (tokenCache && tokenCache.expiresAt > new Date()) return tokenCache.value;

  const response = await requestWithRetry(
    'post',
    'https://accounts.spotify.com/api/token',
    {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
    new URLSearchParams({ grant_type: 'client_credentials' }),
    3,
    'Spotify client-credentials'
  );

  const { access_token, expires_in } = response.data;
  tokenCache = {
    value: access_token,
    expiresAt: new Date(Date.now() + (expires_in - 60) * 1000),
  };
  return access_token;
};

const lookupViaSpotify = async (isrc: string): Promise<string | null> => {
  try {
    const token = await getClientCredentialsToken();
    const response = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/search',
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: `isrc:${isrc}`, type: 'track', limit: 1 },
      },
      undefined,
      3,
      'ISRC search'
    );

    const tracks = response.data?.tracks?.items;
    if (!tracks || tracks.length === 0) return null;
    return tracks[0].id as string;
  } catch (error: any) {
    console.error(`Spotify ISRC fallback failed for ${isrc}:`, error.response?.status ?? error.message);
    return null;
  }
};

// ─── isrcLookup ───────────────────────────────────────────────────────────────
//
// Resolves an ISRC code to a Spotify track ID using a two-stage lookup:
//   1. MusicBrainz (free, no auth, fast for well-known tracks)
//   2. Spotify search fallback (handles new/niche tracks MusicBrainz doesn't yet have)
//
// Returns null if both sources miss or any unrecoverable error occurs.
// Failures are graceful — the track simply receives no audio features.
export const isrcLookup = async (isrc: string | undefined | null): Promise<string | null> => {
  if (!isrc || isrc.trim() === '') return null;

  const trimmed = isrc.trim();

  const mbResult = await lookupViaMusicBrainz(trimmed);
  if (mbResult) return mbResult;

  // MusicBrainz miss — fall back to Spotify search.
  // This covers brand-new releases (MusicBrainz lags days or weeks behind commercial releases)
  // and niche tracks that have never been added to MusicBrainz.
  return lookupViaSpotify(trimmed);
};

// ─── titleAndArtistLookup ─────────────────────────────────────────────────────
//
// Resolves a Spotify track ID from a song title + artist name using Spotify's
// `track:X artist:Y` search syntax. Intended as a Phase 0b fallback for platforms
// (like YouTube) that provide no ISRC in their API responses.
//
// Unlike isrcLookup this is inherently fuzzy — the first result may not be the
// exact recording. It is still a significant improvement over no enrichment at all:
// most well-known tracks will match correctly and unlock audio features.
//
// Uses the same client-credentials token as the ISRC Spotify fallback.
// Returns null on any error or when no result is returned — always treated as a soft miss.
export const titleAndArtistLookup = async (
  artist: string,
  title:  string
): Promise<string | null> => {
  if (!artist || !title) return null;
  try {
    const token = await getClientCredentialsToken();
    const response = await requestWithRetry(
      'get',
      'https://api.spotify.com/v1/search',
      {
        headers: { Authorization: `Bearer ${token}` },
        params:  { q: `track:${title} artist:${artist}`, type: 'track', limit: 1 },
      },
      undefined,
      3,
      'Spotify title+artist search'
    );
    const tracks = response.data?.tracks?.items;
    if (!tracks || tracks.length === 0) return null;
    return tracks[0].id as string;
  } catch (error: any) {
    console.warn(
      `Spotify title+artist search failed for "${title}" by "${artist}":`,
      error.response?.status ?? error.message
    );
    return null;
  }
};
