import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import prisma from '../lib/prisma';

// Checks if a user's Spotify access token is expired and refreshes it automatically.
// Attaches the valid access token to the request object for use in route handlers.
export const refreshTokenMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
    const userId = req.params.userId as string;


  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check if the access token has expired by comparing current time to expiry time
    const isExpired = new Date() > new Date(user.tokenExpiresAt);

    if (isExpired) {
      // Request a new access token from Spotify using the refresh token
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: user.refreshToken,
        }),
        {
          headers: {
            'Authorization': 'Basic ' + Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data;
      const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

      // Save the new access token and expiry time to the database
      await prisma.user.update({
        where: { id: userId },
        data: { accessToken: access_token, tokenExpiresAt },
      });

      // Attach the fresh token to the request so the route handler can use it
      (req as any).accessToken = access_token;
    } else {
      // Token is still valid, attach it directly
      (req as any).accessToken = user.accessToken;
    }

    // Pass control to the next middleware or route handler
    next();

  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};