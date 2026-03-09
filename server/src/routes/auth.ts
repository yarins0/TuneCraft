import { Router } from 'express';
import axios from 'axios';
import prisma from '../lib/prisma';

// Router groups related routes into a modular unit
// that can be mounted onto the main Express app
const router = Router();

// Scopes define the permissions requested from the Spotify account
// Each scope unlocks specific Spotify API endpoints
const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-private',        // required for user profile
  'user-read-email',          // required for user email
  'user-library-read',      // required for accessing liked songs
].join(' '); // Spotify expects scopes as a space-separated string

// GET /auth/login
// Redirects the user to Spotify's authorization page
router.get('/login', (req, res) => {
  // URLSearchParams safely formats key-value pairs into a URL query string
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.REDIRECT_URI!,
    scope: SPOTIFY_SCOPES,
    show_dialog: 'true', // forces the user to re-authorize the app if they've already authorized it
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// GET /auth/callback
// Handles the redirect from Spotify after the user grants or denies permission
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;

  // If the user denied access, Spotify sends an error instead of a code
  if (!code) {
    res.status(400).json({ error: 'Authorization code missing' });
    return;
  }

  try {
    // Exchange the temporary code for a real access token
    // This request must happen server-side to keep the client_secret secure
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI!,
      }),
      {
        headers: {
          // Spotify requires credentials as a Base64 encoded Authorization header
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Fetch the user's Spotify profile using the access token
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { id, display_name, email } = profileResponse.data;

    // Calculate the exact datetime when the access token will expire
    // expires_in is in seconds, so we convert it to milliseconds
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // upsert means "update if exists, create if not"
    // This handles both first-time logins and returning users in one operation
    const user = await prisma.user.upsert({
      where: { spotifyId: id },
      update: {
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
      },
      create: {
        spotifyId: id,
        displayName: display_name,
        email: email ?? null,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
      },
    });

    // Redirects to the frontend callback page with the userId as a query parameter
    res.redirect(`${process.env.FRONTEND_URL}/callback?userId=${user.id}&spotifyId=${user.spotifyId}`);

  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

export default router;