import { Router } from 'express';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import type { Platform } from '../lib/platform/types';

// Router groups related routes into a modular unit
// that can be mounted onto the main Express app
const router = Router();

// GET /auth/login?platform=SPOTIFY
// Redirects the user to the platform's OAuth authorization page.
// The platform query param defaults to SPOTIFY — future platforms can pass a different value.
router.get('/login', (req, res) => {
  const platform = ((req.query.platform as string) || 'SPOTIFY').toUpperCase() as Platform;

  try {
    const authUrl = getAdapter(platform).getAuthUrl();
    res.redirect(authUrl);
  } catch {
    res.status(400).json({ error: `Unsupported platform: ${platform}` });
  }
});

// GET /auth/callback
// Handles the OAuth redirect after the user grants permission.
// Exchanges the one-time code for tokens and upserts the user in the database.
// Currently only Spotify sends users here — future platforms will need their own redirect URIs
// or a platform= query param forwarded through the OAuth state parameter.
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).json({ error: 'Authorization code missing' });
    return;
  }

  // Only Spotify is active — the callback always routes through the Spotify adapter
  const platform: Platform = 'SPOTIFY';

  try {
    const { accessToken, refreshToken, expiresAt, platformUserId, displayName, email } =
      await getAdapter(platform).exchangeCode(code);

    // upsert means "update if the user exists, create if not" — handles returning users and
    // first-time logins in one operation
    const user = await prisma.user.upsert({
      where: { platformUserId },
      update: { accessToken, refreshToken, tokenExpiresAt: expiresAt },
      create: {
        platformUserId,
        displayName,
        email,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        platform,
      },
    });

    // Redirect to the frontend callback page with the internal userId and platform user ID
    res.redirect(
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}`
    );
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /auth/scopes?token=...
// Diagnostic endpoint — returns the Spotify profile for a given token to inspect its scopes.
// Remains Spotify-specific for now since it's a dev/debug tool.
router.get('/scopes', async (req, res) => {
  const { default: axios } = await import('axios');
  const token = req.query.token as string;
  const response = await axios.get('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  res.json(response.data);
});

export default router;
