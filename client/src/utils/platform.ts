import type { CSSProperties } from 'react';
import type { PlatformConfig } from './platform/types';
import { spotifyConfig }    from './platform/spotify';
import { soundcloudConfig } from './platform/soundcloud';
import { tidalConfig }      from './platform/tidal';
import { appleMusicConfig } from './platform/appleMusic';

// Re-export the interface so callers can type-check against it without a deep import.
export type { PlatformConfig };

// ─── Registry ─────────────────────────────────────────────────────────────────

// Maps platform keys (matching the Prisma Platform enum) to their config objects.
// To add a new platform: create a file in platform/, export a PlatformConfig, add it here.
const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  SPOTIFY:     spotifyConfig,
  SOUNDCLOUD:  soundcloudConfig,
  TIDAL:       tidalConfig,
  APPLE_MUSIC: appleMusicConfig,
};

// Resolves the config for a platform key, falling back to Spotify for unknown values.
// All exported utility functions use this so they handle undefined/unknown platforms gracefully.
const getConfig = (platform: string | undefined): PlatformConfig =>
  PLATFORM_CONFIGS[(platform ?? 'SPOTIFY').toUpperCase()] ?? PLATFORM_CONFIGS.SPOTIFY;

// ─── Derived constants ────────────────────────────────────────────────────────

// Record of platform → CSS var() reference for use in inline styles.
// e.g. PLATFORM_COLORS.SPOTIFY → "var(--color-platform-spotify)"
export const PLATFORM_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIGS).map(([k, v]) => [k, `var(${v.cssVar})`])
);

// Record of platform → human-readable display name.
export const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIGS).map(([k, v]) => [k, v.label])
);

// Record of platform → emoji icon.
export const PLATFORM_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIGS).map(([k, v]) => [k, v.icon])
);

// ─── Utility functions ────────────────────────────────────────────────────────

// Returns the external URL to open a track on its native platform.
export const getPlatformTrackUrl = (platform: string | undefined, trackId: string): string =>
  getConfig(platform).trackUrl(trackId);

// Returns the external URL to open a playlist (or liked library when playlistId === 'liked').
export const getPlatformPlaylistUrl = (platform: string | undefined, playlistId: string): string =>
  getConfig(platform).playlistUrl(playlistId);

// Returns inline CSS styles for the platform badge pill in PlaylistDetail.
// color-mix() blends the CSS variable with transparent to produce tinted bg and border colours —
// hex values live only in index.css and never leak into JS.
// Inline styles are required because Tailwind only includes statically-known class strings.
export const getPlatformBadgeStyle = (platform: string | undefined): CSSProperties => {
  const cssVar = getConfig(platform).cssVar;
  return {
    background: `color-mix(in srgb, var(${cssVar}) 15%, transparent)`,
    color:      `var(${cssVar})`,
    border:     `1px solid color-mix(in srgb, var(${cssVar}) 25%, transparent)`,
  };
};

// Returns "Open in {Platform}" for use in tooltips and aria-label attributes.
export const getPlatformLabel = (platform: string | undefined): string =>
  `Open in ${getConfig(platform).label}`;

// Extracts a playlist ID from a user-supplied URL or raw ID for the active platform.
// Does NOT fall back to Spotify — an unknown or mismatched platform returns null so the
// caller can surface a clear "wrong platform" error rather than silently failing downstream.
export const extractPlaylistId = (input: string, platform: string): string | null => {
  const config = PLATFORM_CONFIGS[platform.toUpperCase()];
  return config ? config.extractPlaylistId(input.trim()) : null;
};
