// PlatformConfig defines everything the client needs to know about one streaming platform.
// Each platform implements this in its own file — platform.ts assembles them into a registry.
// To add a new platform: create a new file, export a PlatformConfig, register it in platform.ts.
// Configuration for the access-request gate shown before OAuth when a platform
// restricts the number of users that can log in (e.g. Google test mode, Spotify dev mode).
export interface AccessRequestConfig {
  // How many test users the platform allows before requiring production approval.
  userLimit: number;
  // Label for the email input field — each platform uses a different account type.
  // e.g. "Spotify Email", "Google Account Email"
  emailLabel: string;
  // Text on the "I'm already approved" button that skips the form and goes to OAuth.
  continueLabel: string;
  // One-sentence description of the restriction shown at the top of the modal.
  description: string;
}

export interface PlatformConfig {
  // Human-readable name for UI labels and error messages (e.g. "Tidal")
  label: string;
  // Emoji avatar used where a logo image is unavailable
  icon: string;
  // CSS custom-property name defined in index.css — the single source of truth for brand colours.
  // Never hardcode hex values here; referencing the variable lets theme changes propagate everywhere.
  cssVar: string;

  // Whether this platform is live and connectable via OAuth.
  // false = shown on the Login page with a "coming soon" badge, button disabled.
  available: boolean;
  // True when the Login page should show an access-request gate before redirecting to OAuth.
  // Platforms in developer/test mode (Spotify, YouTube) require users to be manually added
  // to an allowlist before they can authenticate — this gate lets them request that access.
  // Must be accompanied by an `accessRequest` config when true.
  requiresAccessRequest: boolean;
  // Platform-specific strings for the access-request modal. Required when requiresAccessRequest is true.
  accessRequest?: AccessRequestConfig;
  // True when the platform restricts reading playlists owned by other users.
  // PlaylistDetail reads this to show an ownership-specific error instead of a generic one.
  ownershipRestricted: boolean;
  // True when the platform API returns playlists the user has followed/saved from other channels
  // alongside their own playlists. False when only user-owned playlists are accessible.
  // Dashboard uses this to show a contextual notice when followed playlists can't be listed.
  followedPlaylistsSupported: boolean;
  // False when the platform's API does not reliably return a total track count during pagination.
  // PlaylistDetail falls back to the dashboard's known count when this is false.
  totalTracksReliable: boolean;
  // Optional human-readable hint explaining why audio features may be missing for this platform.
  // Shown in PlaylistDetail when fewer than 20% of tracks have feature data.
  // undefined = show a generic fallback message with no platform-specific context.
  audioFeaturesMissingHint?: string;

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
