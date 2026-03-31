import { Router } from 'express';
import type { Request, Response } from 'express';
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
const SUPPORTED_PLATFORMS: readonly string[] = ['SPOTIFY', 'SOUNDCLOUD', 'TIDAL', 'YOUTUBE'];

router.get('/login', (req, res) => {
  const platform = ((req.query.platform as string) || 'SPOTIFY').toUpperCase();

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    res.status(400).json({ error: 'Unsupported platform' });
    return;
  }

  try {
    const authUrl = getAdapter(platform as Platform).getAuthUrl();
    res.redirect(authUrl);
  } catch {
    res.status(400).json({ error: 'Unsupported platform' });
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
    res.redirect(`${process.env.FRONTEND_URL}/?error=denied`);
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
    res.redirect(`${process.env.FRONTEND_URL}/?error=denied`);
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
    res.redirect(`${process.env.FRONTEND_URL}/?error=denied`);
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

// GET /auth/youtube/callback
// Handles the Google OAuth redirect after the user grants permission.
// Google uses the same authorization-code flow as Spotify and SoundCloud —
// no PKCE or state parameter required.
router.get('/youtube/callback', async (req, res) => {
  const code  = req.query.code  as string | undefined;
  const error = req.query.error as string | undefined;

  // User denied permission on the Google consent screen
  if (error) {
    res.redirect(`${process.env.FRONTEND_URL}/?error=denied`);
    return;
  }

  if (!code) {
    res.status(400).json({ error: 'Authorization code missing' });
    return;
  }

  const platform: Platform = 'YOUTUBE';

  try {
    const { accessToken, refreshToken, expiresAt, platformUserId, displayName, email } =
      await getAdapter(platform).exchangeCode(code);

    const user = await prisma.user.upsert({
      where:  { platformUserId_platform: { platformUserId, platform } },
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
  } catch (error: any) {
    const body = error?.response?.data;
    const msg  = body?.error?.message ?? body?.error ?? JSON.stringify(body ?? error?.message ?? error);
    console.error('YouTube auth error:', msg);
    res.redirect(`${process.env.FRONTEND_URL}/?error=auth_failed`);
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

// ── Access request helpers ────────────────────────────────────────────────────

// Minimum time between access-request emails from the same email address.
// Any submission within this window returns 429 without touching the DB or sending email.
const ACCESS_REQUEST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// "john" → "John", "DOE" → "Doe"
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// Escapes HTML special characters before interpolating user-supplied values into emails.
// Without this, a name like "<script>..." would be rendered as live HTML — XSS against the admin.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Returns true if this email+platform submitted a request within the cooldown window.
// Checks regardless of status — cooldown applies to all submissions, not just pending ones.
const isOnCooldown = async (email: string, platform: Platform): Promise<boolean> => {
  const cutoff = new Date(Date.now() - ACCESS_REQUEST_COOLDOWN_MS);
  const recent = await prisma.accessRequest.findFirst({
    where: { email, platform, createdAt: { gte: cutoff } },
  });
  return recent !== null;
};

// Creates an AccessRequest row only if no PENDING row exists for this email + platform.
// Prevents duplicate DB entries while still allowing re-submission after a request is resolved.
const upsertAccessRequest = async (
  email: string,
  fullName: string,
  platform: Platform,
): Promise<void> => {
  const existing = await prisma.accessRequest.findFirst({
    where: { email, platform, status: 'PENDING' },
  });
  if (!existing) {
    await prisma.accessRequest.create({ data: { fullName, email, platform } });
  }
};

// Sends the admin notification email for an access request.
const sendAccessRequestEmail = async (
  name: string,
  email: string,
  platformLabel: string,
  subject: string,
  dashboardHtml: string,
): Promise<void> => {
  await resend.emails.send({
    from:    'Tunecraft <onboarding@resend.dev>',
    to:      process.env.ADMIN_EMAIL!,
    subject,
    html: `
      <p>A new user is requesting ${escapeHtml(platformLabel)} access on Tunecraft.</p>
      <table cellpadding="6">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
      </table>
      ${dashboardHtml}
    `,
  });
};

// Platform-specific strings passed to the shared handler.
interface AccessRequestEmailConfig {
  platformLabel: string;
  subject:       (name: string) => string;
  dashboardHtml: string;
}

// Shared handler for all platform access-request endpoints.
// Validates input → enforces cooldown → upserts DB row → emails admin.
const handleAccessRequest = async (
  req: Request,
  res: Response,
  platform: Platform,
  emailConfig: AccessRequestEmailConfig,
): Promise<void> => {
  const { firstName, lastName, email } = req.body as {
    firstName?: string;
    lastName?:  string;
    email?:     string;
  };

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'First name, last name, and email are required.' });
    return;
  }

  // Basic length limits to prevent DB pollution
  if (firstName.trim().length > 100 || lastName.trim().length > 100) {
    res.status(400).json({ error: 'Name fields must be 100 characters or fewer.' });
    return;
  }

  // RFC 5321 max email length is 254 characters; reject obviously malformed addresses early
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email.trim().length > 254 || !EMAIL_PATTERN.test(email.trim())) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  if (!process.env.ADMIN_EMAIL) {
    console.error('ADMIN_EMAIL env var is not set — cannot send access request notification');
    res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    return;
  }

  const name           = `${capitalize(firstName.trim())} ${capitalize(lastName.trim())}`;
  const normalizedEmail = email.trim();

  try {
    if (await isOnCooldown(normalizedEmail, platform)) {
      res.status(429).json({ error: 'You already submitted a request recently. Please wait an hour before trying again.' });
      return;
    }

    await upsertAccessRequest(normalizedEmail, name, platform);
    await sendAccessRequestEmail(
      name,
      normalizedEmail,
      emailConfig.platformLabel,
      emailConfig.subject(name),
      emailConfig.dashboardHtml,
    );

    res.json({ success: true });
  } catch (error) {
    console.error(`${platform} access request error:`, error);
    res.status(500).json({ error: 'Failed to submit request. Please try again.' });
  }
};

// ── Access request routes ─────────────────────────────────────────────────────

// POST /auth/spotify/request-access
// Saves a Spotify access request and emails the admin to add the user to the
// Spotify Developer Dashboard allowlist.
router.post('/spotify/request-access', (req, res) =>
  handleAccessRequest(req, res, 'SPOTIFY', {
    platformLabel: 'Spotify',
    subject:       name => `[Tunecraft] Spotify access request — ${name}`,
    dashboardHtml: `
      <p>
        Add them at:<br/>
        <a href="https://developer.spotify.com/dashboard">
          Spotify Developer Dashboard → Your App → User Management
        </a>
      </p>
    `,
  })
);

// POST /auth/youtube/request-access
// Saves a YouTube Music access request and emails the admin to add the user to the
// Google Cloud Console OAuth consent screen test-user list.
router.post('/youtube/request-access', (req, res) =>
  handleAccessRequest(req, res, 'YOUTUBE', {
    platformLabel: 'YouTube Music',
    subject:       name => `[Tunecraft] YouTube Music access request — ${name}`,
    dashboardHtml: `
      <p>
        Add them at:<br/>
        <a href="https://console.cloud.google.com/apis/credentials/consent">
          Google Cloud Console → OAuth consent screen → Test users
        </a>
      </p>
    `,
  })
);

export default router;
