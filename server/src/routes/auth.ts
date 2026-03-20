import { Router } from 'express';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import { TidalAdapter } from '../lib/platform/tidal';
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

// GET /auth/spotify/callback
// Handles the Spotify OAuth redirect after the user grants permission.
// Registered as the redirect URI in the Spotify Developer Dashboard.
router.get('/spotify/callback', async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string | undefined;

  // User denied permission on the Spotify consent screen
  if (error) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=denied`);
    return;
  }

  if (!code) {
    res.status(400).json({ error: 'Authorization code missing' });
    return;
  }

  const platform: Platform = 'SPOTIFY';

  try {
    const { accessToken, refreshToken, expiresAt, platformUserId, displayName, email } =
      await getAdapter(platform).exchangeCode(code);

    // upsert means "update if the user exists, create if not" — handles returning users and
    // first-time logins in one operation.
    // The unique key is (platformUserId + platform) together — Spotify and SoundCloud have
    // separate ID namespaces, so the same numeric ID could exist on both platforms.
    const user = await prisma.user.upsert({
      where: { platformUserId_platform: { platformUserId, platform } },
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

    res.redirect(
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}`
    );
  } catch (error) {
    console.error('Spotify auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /auth/soundcloud/callback
// Handles the SoundCloud OAuth redirect after the user grants permission.
// SoundCloud requires a separate redirect URI registered in the developer app —
// that's why this is a different endpoint rather than reusing /auth/callback.
router.get('/soundcloud/callback', async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string | undefined;

  // User denied permission on the SoundCloud consent screen
  if (error) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=denied`);
    return;
  }

  if (!code) {
    res.status(400).json({ error: 'Authorization code missing' });
    return;
  }

  const platform: Platform = 'SOUNDCLOUD';

  try {
    const { accessToken, refreshToken, expiresAt, platformUserId, displayName, email } =
      await getAdapter(platform).exchangeCode(code);

    const user = await prisma.user.upsert({
      where: { platformUserId_platform: { platformUserId, platform } },
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

    res.redirect(
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}`
    );
  } catch (error) {
    console.error('SoundCloud auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /auth/tidal/callback
// Handles the Tidal OAuth PKCE redirect after the user grants permission.
// Unlike Spotify/SoundCloud, Tidal uses PKCE — the callback receives a `state` parameter
// that we use to retrieve the code_verifier we stashed before redirecting the user.
// The verifier must be sent to the token endpoint to complete the exchange.
router.get('/tidal/callback', async (req, res) => {
  const code  = req.query.code  as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  // User denied permission on the Tidal consent screen
  if (error) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=denied`);
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: 'Authorization code or state missing' });
    return;
  }

  // The TidalAdapter stores PKCE verifiers keyed by state. Cast to access the method
  // since the PlatformAdapter interface does not expose it (it's Tidal-specific).
  const tidalAdapter = getAdapter('TIDAL') as TidalAdapter;
  const verifier = tidalAdapter.consumeVerifier(state);

  if (!verifier) {
    // State unknown or expired — likely a replay attack or the server restarted mid-flow
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }

  const platform: Platform = 'TIDAL';

  try {
    const { accessToken, refreshToken, expiresAt, platformUserId, displayName, email } =
      await tidalAdapter.exchangeCode(code, verifier);

    const user = await prisma.user.upsert({
      where: { platformUserId_platform: { platformUserId, platform } },
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

    res.redirect(
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}`
    );
  } catch (error) {
    console.error('Tidal auth error:', error);
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
