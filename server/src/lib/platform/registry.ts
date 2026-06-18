import prisma from '../prisma';
import { SpotifyAdapter } from './spotify';
import { SoundCloudAdapter } from './soundcloud';
import { TidalAdapter } from './tidal';
import { YouTubeAdapter } from './youtube';
import { ReauthRequiredError } from './errors';
import type { Platform, PlatformAdapter } from './types';

// Registry maps each platform to its singleton adapter instance.
// One instance per platform lives for the lifetime of the server process.
// To add a new platform: import its adapter here and add it to this map.
const adapters: Partial<Record<Platform, PlatformAdapter>> = {
  SPOTIFY:    new SpotifyAdapter(),
  SOUNDCLOUD: new SoundCloudAdapter(),
  TIDAL:      new TidalAdapter(),
  YOUTUBE:    new YouTubeAdapter(),
};

// Returns all registered adapter instances.
// Used by the enrichment pipeline to derive platform-specific column names without
// hardcoding platform lists — adding a new platform only requires registering it here.
export const getAllAdapters = (): PlatformAdapter[] => Object.values(adapters) as PlatformAdapter[];

// Returns the adapter for the given platform.
// Throws if no adapter is registered — this signals an unimplemented platform,
// not a runtime configuration error.
export const getAdapter = (platform: Platform): PlatformAdapter => {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }
  return adapter;
};

// Shape returned by getValidAccessToken.
// Callers that only need the token destructure accessToken; the middleware also reads platform
// to attach it to the request without a second DB round-trip.
export interface ValidTokenResult {
  accessToken: string;
  platform: string;
}

// Clears a user's stored OAuth credentials after their refresh token is rejected.
// accessToken and refreshToken are non-nullable columns, so they are blanked rather
// than set to null; tokenExpiresAt is set to the epoch so every expiry check treats
// the credentials as invalid. The User row itself is preserved, so the user's
// playlists and reshuffle schedules survive until they sign in again.
const discardStoredTokens = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { accessToken: '', refreshToken: '', tokenExpiresAt: new Date(0) },
  });
};

// Returns a valid access token for any user, regardless of which platform they authenticated with.
// Checks the token's expiry time — if expired, calls the platform adapter to refresh it
// and persists the new token to the database before returning.
//
// Returns null when the user doesn't exist or the refresh fails transiently (network/5xx),
// so the caller can safely retry later. Throws ReauthRequiredError when the refresh token
// is permanently invalid — the stored credentials are discarded first so they are never
// retried, and the caller must send the user back through sign-in.
export const getValidAccessToken = async (userId: string): Promise<ValidTokenResult | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Token is still valid — return it directly without a network call
  if (user.tokenExpiresAt > new Date()) {
    return { accessToken: user.accessToken, platform: user.platform };
  }

  // An empty refresh token means it was already discarded after a prior invalid_grant.
  // Fail fast with reauth instead of calling the platform with a credential we know is dead.
  if (!user.refreshToken) {
    throw new ReauthRequiredError(user.platform);
  }

  // Token is expired — ask the platform adapter to refresh it
  try {
    const adapter = getAdapter(user.platform as Platform);
    const { accessToken, expiresAt } = await adapter.refreshAccessToken(user.refreshToken);

    await prisma.user.update({
      where: { id: userId },
      data: { accessToken, tokenExpiresAt: expiresAt },
    });

    return { accessToken, platform: user.platform };
  } catch (error) {
    // Refresh token is permanently dead — discard the stored credentials so they are
    // never retried, then rethrow so the caller can trigger re-authentication.
    if (error instanceof ReauthRequiredError) {
      await discardStoredTokens(userId);
      throw error;
    }
    // Transient failure (network/5xx) — keep the token so the next request can retry.
    console.error(`Failed to refresh token for user ${userId}:`, error);
    return null;
  }
};
