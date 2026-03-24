import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getValidAccessToken } from '../lib/platform/registry';

// Checks whether the user's platform access token is expired and refreshes it if needed.
// After this middleware runs, req.accessToken always holds a valid token and
// req.userPlatform holds the user's platform — both are available to downstream route handlers.
export const refreshTokenMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const userId = req.params.userId as string;

  // Verify the HMAC token sent by the client in X-User-Token.
  // This binds the userId in the URL to a secret only the server and the legitimate
  // user's browser know — preventing any caller who merely knows a userId from acting as
  // that user.
  // timingSafeEqual prevents timing attacks that could leak the expected token length.
  const clientToken = req.headers['x-user-token'] as string | undefined;
  const expectedToken = createHmac('sha256', process.env.HMAC_SECRET!).update(userId).digest('hex');
  const expectedBuf = Buffer.from(expectedToken, 'hex');
  const clientBuf   = Buffer.from(clientToken ?? '', 'hex');
  const tokenValid  =
    clientBuf.length === expectedBuf.length &&
    timingSafeEqual(clientBuf, expectedBuf);

  if (!tokenValid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // getValidAccessToken handles the DB lookup, expiry check, refresh, and persist in one place.
  // It also returns the platform so we can attach it to the request without a second DB round-trip.
  try {
    const result = await getValidAccessToken(userId);

    if (!result) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    req.accessToken  = result.accessToken;
    req.userPlatform = result.platform;

    next();
  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};
