import { Router } from 'express';
import { createHmac } from 'crypto';
import { Resend } from 'resend';
import prisma from '../lib/prisma';
import { getAdapter } from '../lib/platform/registry';
import { TidalAdapter } from '../lib/platform/tidal';
import type { Platform } from '../lib/platform/types';
import { refreshTokenMiddleware } from '../middleware/refreshToken';

// Signs a userId with the server's HMAC secret, producing a token the client stores and
// sends with every request. The server verifies this token in refreshTokenMiddleware before
// processing any authenticated route — preventing one user from acting as another by merely
// knowing their userId cuid.
const signUserId = (userId: string): string =>
  createHmac('sha256', process.env.HMAC_SECRET!).update(userId).digest('hex');

// Resend client — initialised once and reused for all outgoing emails.
// The API key is loaded from .env; if missing, email sending will fail gracefully
// without crashing the server (the catch block in the route handles it).
const resend = new Resend(process.env.RESEND_API_KEY);

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
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}&userToken=${signUserId(user.id)}`
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
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}&userToken=${signUserId(user.id)}`
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
      `${process.env.FRONTEND_URL}/callback?userId=${user.id}&platformUserId=${user.platformUserId}&platform=${platform}&displayName=${encodeURIComponent(user.displayName ?? '')}&userToken=${signUserId(user.id)}`
    );
  } catch (error) {
    console.error('Tidal auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// DELETE /auth/:userId
// Removes a single platform account from the database.
// Only deletes the User row matching the given internal cuid — other platform
// accounts connected in the same browser session are stored as separate rows
// and are not affected.
// Returns 204 No Content on success; 404 if the user doesn't exist.
router.delete('/:userId', refreshTokenMiddleware, async (req, res) => {
  const userId = req.params.userId as string;

  try {
    await prisma.user.delete({ where: { id: userId } });
    res.status(204).send();
  } catch (err: unknown) {
    // Prisma throws P2025 when the record to delete is not found
    const isPrismaNotFound =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2025';

    if (isPrismaNotFound) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// POST /auth/spotify/request-access
// Saves a Spotify access request to the DB and emails the admin to add the user
// to the Spotify Developer Dashboard allowlist.
// Duplicate requests (same email, status=PENDING) are silently ignored so the
// user can safely resubmit without flooding the admin's inbox.
router.post('/spotify/request-access', async (req, res) => {
  const { firstName, lastName, email } = req.body as {
    firstName?: string;
    lastName?:  string;
    email?:     string;
  };

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'First name, last name, and email are required.' });
    return;
  }

  if (!process.env.ADMIN_EMAIL) {
    console.error('ADMIN_EMAIL env var is not set — cannot send access request notification');
    res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    return;
  }

  // Capitalize each name part independently, then join — "john doe" → "John Doe".
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const normalizedName = `${capitalize(firstName.trim())} ${capitalize(lastName.trim())}`;

  // Escape HTML special characters before interpolating user-supplied values into the
  // admin notification email. Without this, a name like "<script>..." would be rendered
  // as live HTML in the email client — a stored XSS risk against the admin.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  try {
    // Check for an existing pending request from the same email address.
    const existing = await prisma.spotifyAccessRequest.findFirst({
      where: { email: email.trim(), status: 'PENDING' },
    });

    // Retrieve or create the DB record so we can embed its ID in the notification
    // email — the inbound-email handler uses the ID for a reliable exact-match
    // lookup when the admin replies to approve or reject the request.
    const requestRecord = existing ?? await prisma.spotifyAccessRequest.create({
      data: { fullName: normalizedName, email: email.trim() },
    });

    // Send the admin notification regardless of whether this is a duplicate —
    // the email is a prompt to act, not a record of every submission.
    await resend.emails.send({
      from:    'Tunecraft <onboarding@resend.dev>',
      to:      process.env.ADMIN_EMAIL!,
      subject: `[Tunecraft] Spotify access request — ${normalizedName} [${requestRecord.id}]`,
      html: `
        <p>A new user is requesting Spotify access on Tunecraft.</p>
        <table cellpadding="6">
          <tr><td><strong>Name</strong></td><td>${escapeHtml(normalizedName)}</td></tr>
          <tr><td><strong>Email</strong></td><td>${escapeHtml(email.trim())}</td></tr>
        </table>
        <p>Reply to this email with <strong>APPROVED</strong> or <strong>REJECTED</strong>
        to update the request status automatically.</p>
        <p>
          Add them at:<br/>
          <a href="https://developer.spotify.com/dashboard">
            Spotify Developer Dashboard → Your App → User Management
          </a>
        </p>
      `,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Spotify access request error:', error);
    res.status(500).json({ error: 'Failed to submit request. Please try again.' });
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
