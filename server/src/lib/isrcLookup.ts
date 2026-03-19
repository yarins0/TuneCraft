import { requestWithRetry } from './requestWithRetry';

// Module-level token cache — a Spotify client credentials token is good for 3600 seconds.
// We refresh it 60 seconds early to avoid using a token that is about to expire mid-request.
// This cache is shared across all ISRC lookups in the same server process.
let tokenCache: { value: string; expiresAt: Date } | null = null;

// Returns a valid Spotify client credentials access token.
//
// Client credentials flow authenticates as the app (not as any specific user) — it grants
// access to public Spotify endpoints like search, which is all ISRC lookup needs.
// No user is involved and no OAuth redirect is required.
const getClientCredentialsToken = async (): Promise<string> => {
  // Return cached token if it is still valid
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
    // Subtract 60s so the token is never used in its last minute of validity
    expiresAt: new Date(Date.now() + (expires_in - 60) * 1000),
  };

  return access_token;
};

// Looks up a Spotify track ID for a given ISRC code.
//
// ISRC (International Standard Recording Code) is a universal identifier that follows
// a song across every platform — Spotify, SoundCloud, Deezer, Apple Music all carry it
// for commercially released tracks. Independent/upload tracks often have no ISRC.
//
// This is the bridge between SoundCloud track data and ReccoBeats audio features:
//   SoundCloud track → read its ISRC → search Spotify → get Spotify track ID → ReccoBeats
//
// Returns null if:
//   - isrc is empty, null, or undefined
//   - Spotify has no track matching that ISRC
//   - Any API error occurs (fails gracefully — track just gets no audio features)
export const isrcLookup = async (isrc: string | undefined | null): Promise<string | null> => {
  if (!isrc || isrc.trim() === '') return null;

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
      'Spotify ISRC search'
    );

    const tracks = response.data?.tracks?.items;
    if (!tracks || tracks.length === 0) return null;

    return tracks[0].id as string;
  } catch (error: any) {
    console.error(
      `ISRC lookup failed for ${isrc}:`,
      error.response?.status ?? error.message
    );
    return null;
  }
};
