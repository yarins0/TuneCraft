// PlatformConfig defines everything the client needs to know about one streaming platform.
// Each platform implements this in its own file — platform.ts assembles them into a registry.
// To add a new platform: create a new file, export a PlatformConfig, register it in platform.ts.
export interface PlatformConfig {
  // Human-readable name for UI labels and error messages (e.g. "Tidal")
  label: string;
  // Emoji avatar used where a logo image is unavailable
  icon: string;
  // CSS custom-property name defined in index.css — the single source of truth for brand colours.
  // Never hardcode hex values here; referencing the variable lets theme changes propagate everywhere.
  cssVar: string;
  // Returns the external deep-link to open a single track on the native platform
  trackUrl: (trackId: string) => string;
  // Returns the external deep-link to open a playlist, or the liked/saved library when id === 'liked'
  playlistUrl: (playlistId: string) => string;
  // Extracts a bare playlist ID from a user-supplied URL or raw ID string.
  // Returns null if the input does not match this platform's known URL format — cross-platform
  // URLs are intentionally rejected so callers can surface a clear mismatch error.
  // Returns a normalised https:// URL for platforms where the slug needs server-side resolution
  // (SoundCloud) — callers route those to discoverPlaylistByUrl() instead of discoverPlaylist().
  extractPlaylistId: (input: string) => string | null;
}
