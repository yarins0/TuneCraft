import axios from 'axios';
import prisma from '../prisma';

// Fetches a valid Spotify access token for a user, refreshing it if expired.
// Returns null if the user doesn't exist or the refresh fails.
export const getSpotifyAccessToken = async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Token is still valid — use it directly
  if (user.tokenExpiresAt > new Date()) {
    return user.accessToken;
  }

  // Token is expired — exchange the refresh token for a new one
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: user.refreshToken,
      }),
      {
        headers: {
          Authorization: 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = response.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Persist the new token so the next request doesn't need to refresh again
    await prisma.user.update({
      where: { id: userId },
      data: { accessToken: access_token, tokenExpiresAt },
    });

    return access_token;
  } catch (error) {
    console.error(`Failed to refresh Spotify token for user ${userId}:`, error);
    return null;
  }
};
