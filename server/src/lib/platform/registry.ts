import prisma from '../prisma';
import { SpotifyAdapter } from './spotify';
import type { Platform, PlatformAdapter } from './types';

// Registry maps each platform to its singleton adapter instance.
// One instance per platform lives for the lifetime of the server process.
// To add a new platform: import its adapter here and add it to this map.
const adapters: Partial<Record<Platform, PlatformAdapter>> = {
  SPOTIFY: new SpotifyAdapter(),
  // SOUNDCLOUD: new SoundCloudAdapter(),  ← add when implemented
  // APPLE_MUSIC: new AppleMusicAdapter(), ← add when implemented
};

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

// Returns a valid access token for any user, regardless of which platform they authenticated with.
// Checks the token's expiry time — if expired, calls the platform adapter to refresh it
// and persists the new token to the database before returning.
//
// Replaces the old getSpotifyAccessToken from lib/auth/spotify.ts with a platform-agnostic version.
// Returns null if the user doesn't exist or the refresh fails.
export const getValidAccessToken = async (userId: string): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Token is still valid — return it directly without a network call
  if (user.tokenExpiresAt > new Date()) return user.accessToken;

  // Token is expired — ask the platform adapter to refresh it
  try {
    const adapter = getAdapter(user.platform as Platform);
    const { accessToken, expiresAt } = await adapter.refreshAccessToken(user.refreshToken);

    await prisma.user.update({
      where: { id: userId },
      data: { accessToken, tokenExpiresAt: expiresAt },
    });

    return accessToken;
  } catch (error) {
    console.error(`Failed to refresh token for user ${userId}:`, error);
    return null;
  }
};
