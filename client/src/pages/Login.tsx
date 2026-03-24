import { useState } from 'react';
import { API_BASE_URL } from '../api/config';
import AppFooter from '../components/AppFooter';
import SpotifyAccessModal from '../components/SpotifyAccessModal';
import { getAllPlatformConfigs, PLATFORM_COLORS } from '../utils/platform';

// Redirects the user to the selected platform's OAuth login flow via the Tunecraft backend.
// The platform query param tells the server which adapter to use.
const handleLogin = (platform: string) => {
  window.location.href = `${API_BASE_URL}/auth/login?platform=${platform}`;
};

// Derived from the platform registry — no platform names are hardcoded here.
// To add a platform to the Login picker, set `available: true` in its config file.
const PLATFORMS = getAllPlatformConfigs().map(p => ({
  id:        p.id,
  label:     p.label,
  available: p.available,
  color:     PLATFORM_COLORS[p.id],
}));

export default function Login() {
  // The OAuth callback redirects back here with ?error=denied when the user cancels
  // the authorization screen on Spotify or SoundCloud. Show a brief explanatory message
  // so they're not confused by the page reloading with no feedback.
  const denied = new URLSearchParams(window.location.search).get('error') === 'denied';

  // Controls whether the Spotify access modal is open.
  // Clicking "Connect Spotify" opens it instead of immediately redirecting,
  // so the user can confirm they're approved or request access if they're not.
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* Centered main content fills available space above the footer */}
      <div className="relative flex-1 flex items-center justify-center">
        {/* Glowing background orb */}
        <div className="absolute w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center gap-8 text-center px-8">
          {/* Logo */}
          <div>
            <div className="flex items-center justify-center gap-4">
              <img src="/favicon.svg" alt="TuneCraft icon" className="h-16 w-16" />
              <div className="text-left">
                <h1 className="text-6xl font-black tracking-tighter text-text-primary">
                  Tune<span className="text-accent">craft</span>
                </h1>
                <p className="text-text-muted text-lg mt-1 font-light tracking-wide">
                  Your music, engineered.
                </p>
              </div>
            </div>
          </div>

          {/* Feature list */}
          <div className="flex flex-col gap-2 text-text-muted text-sm">
            <p>⚡ Smarter shuffles</p>
            <p>🎛️ Playlist engineering</p>
            <p>🔀 Auto-reshuffle on schedule</p>
          </div>

          {/* OAuth denial message — shown when redirected back with ?error=denied */}
          {denied && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 max-w-xs text-center">
              Authorization was cancelled. Connect below to try again.
            </p>
          )}

          {/* Platform picker */}
          <div className="flex flex-col gap-3 w-full max-w-xs">
            {PLATFORMS.map(({ id, label, available, color }) => (
              <button
                key={id}
                onClick={available
                  ? id === 'SPOTIFY'
                    ? () => setShowSpotifyModal(true)
                    : () => handleLogin(id)
                  : undefined}
                disabled={!available}
                title={available ? undefined : 'Coming soon'}
                // --btn-color exposes the brand colour as a CSS custom property so Tailwind's
                // arbitrary-value utilities can reference it for border, glow, and hover effects
                // without hardcoding any hex values in the className string.
                style={{ '--btn-color': color } as React.CSSProperties}
                className={
                  available
                    ? 'relative text-text-primary font-bold px-10 py-4 rounded-full text-lg border-2 border-[var(--btn-color)] bg-transparent transition-all duration-300 hover:scale-105 active:scale-95 hover:[box-shadow:0_0_24px_color-mix(in_srgb,var(--btn-color)_55%,transparent)]'
                    : 'relative text-text-muted font-bold px-10 py-4 rounded-full text-lg border-2 border-border-color bg-transparent opacity-40 cursor-not-allowed'
                }
              >
                Connect {label}
                {!available && (
                  <span className="absolute -top-2 -right-2 text-[10px] font-semibold bg-bg-card border border-border-color text-text-muted px-2 py-0.5 rounded-full">
                    soon
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className="text-text-muted text-xs">
            Tunecraft never stores your passwords.
          </p>
        </div>
      </div>

      {showSpotifyModal && (
        <SpotifyAccessModal
          onApproved={() => { setShowSpotifyModal(false); handleLogin('spotify'); }}
          onClose={() => setShowSpotifyModal(false)}
        />
      )}

      <AppFooter />
    </div>
  );
}
