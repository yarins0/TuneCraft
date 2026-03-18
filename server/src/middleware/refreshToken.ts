import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import type { Platform } from '../lib/platform/types';

// Checks whether the user's platform access token is expired and refreshes it if needed.
// After this middleware runs, req.accessToken always holds a valid token and
// req.userPlatform holds the user's platform — both are available to downstream route handlers.
export const refreshTokenMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const userId = req.params.userId as string;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Attach the platform early so route handlers can resolve the correct adapter
    (req as any).userPlatform = user.platform;

    const isExpired = new Date() > new Date(user.tokenExpiresAt);

    if (isExpired) {
      // Resolve the adapter for this user's platform and request a fresh token
      const adapter = getAdapter(user.platform as Platform);
      const { accessToken, expiresAt } = await adapter.refreshAccessToken(user.refreshToken);

      await prisma.user.update({
        where: { id: userId },
        data: { accessToken, tokenExpiresAt: expiresAt },
      });

      (req as any).accessToken = accessToken;
    } else {
      (req as any).accessToken = user.accessToken;
    }

    next();
  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};
