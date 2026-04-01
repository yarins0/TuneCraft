import { useState } from 'react';
import { API_BASE_URL } from '../api/config';
import AppFooter from '../components/AppFooter';
import AccessRequestModal from '../components/AccessRequestModal';
import { getAllPlatformConfigs, PLATFORM_COLORS } from '../utils/platform';
import type { AccessRequestConfig } from '../utils/platform/types';

// Redirects the user to the selected platform's OAuth login flow via the Tunecraft backend.
// The platform query param tells the server which adapter to use.
const handleLogin = (platform: string) => {
  window.location.href = `${API_BASE_URL}/auth/login?platform=${platform}`;
};

// Derived from the platform registry — no platform names are hardcoded here.
// To add a platform to the Login picker, set `available: true` in its config file.
const PLATFORMS = getAllPlatformConfigs().map(p => ({
  id:                    p.id,
  label:                 p.label,
  available:             p.available,
  color:                 PLATFORM_COLORS[p.id],
  requiresAccessRequest: p.requiresAccessRequest,
  accessRequest:         p.accessRequest,
}));

// Tracks which platform's access-request modal is open, if any.
interface ActiveModal {
  platformId:    string;
  platformLabel: string;
  platformColor: string;
  config:        AccessRequestConfig;
}

export default function Login() {
  // The OAuth callback redirects back here with an ?error= param on failure.
  // "denied"     → user cancelled the authorization screen
  // "auth_failed" → server-side error (e.g. quota exceeded, API misconfiguration)
  const errorParam = new URLSearchParams(window.location.search).get('error');
  const denied     = errorParam === 'denied';
  const authFailed = errorParam === 'auth_failed';

  // Non-null when an access-request gate modal is open for a specific platform.
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);

  // Opens the access-request gate for a platform that requires it,
  // or goes directly to OAuth for platforms that don't.
  const handleConnect = (platform: (typeof PLATFORMS)[number]) => {
    if (platform.requiresAccessRequest && platform.accessRequest) {
      setActiveModal({
        platformId:    platform.id,
        platformLabel: platform.label,
        platformColor: platform.color,
        config:        platform.accessRequest,
      });
    } else {
      handleLogin(platform.id);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* Centered main content fills available space above the footer */}
      <div className="relative flex-1 flex items-center justify-center">
        {/* Glowing background orb */}
        <div className="absolute w-[min(500px,90vw)] h-[min(500px,90vw)] bg-accent/20 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center gap-8 text-center px-8">
          {/* Logo */}
          <div>
            <div className="flex items-center justify-center gap-4">
              <img src="/favicon.svg" alt="TuneCraft icon" className="h-16 w-16" />
              <div className="text-left">
                <h1 className="text-4xl sm:text-6xl font-black tracking-tighter text-text-primary">
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

          {/* Server-side auth failure — quota exceeded, API misconfiguration, etc. */}
          {authFailed && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 max-w-xs text-center">
              Connection failed. Please try again in a few minutes.
            </p>
          )}

          {/* Platform picker */}
          <div className="flex flex-col gap-3 w-full max-w-xs">
            {PLATFORMS.map(platform => (
              <button
                key={platform.id}
                onClick={platform.available ? () => handleConnect(platform) : undefined}
                disabled={!platform.available}
                title={platform.available ? undefined : 'Coming soon'}
                // --btn-color exposes the brand colour as a CSS custom property so Tailwind's
                // arbitrary-value utilities can reference it for border, glow, and hover effects
                // without hardcoding any hex values in the className string.
                style={{ '--btn-color': platform.color } as React.CSSProperties}
                className={
                  platform.available
                    ? 'relative text-text-primary font-bold px-10 py-4 rounded-full text-lg border-2 border-[var(--btn-color)] bg-transparent transition-all duration-300 hover:scale-105 active:scale-95 hover:[box-shadow:0_0_24px_color-mix(in_srgb,var(--btn-color)_55%,transparent)]'
                    : 'relative text-text-muted font-bold px-10 py-4 rounded-full text-lg border-2 border-border-color bg-transparent opacity-40 cursor-not-allowed'
                }
              >
                Connect {platform.label}
                {!platform.available && (
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

      {activeModal && (
        <AccessRequestModal
          platformId={activeModal.platformId}
          platformLabel={activeModal.platformLabel}
          platformColor={activeModal.platformColor}
          config={activeModal.config}
          onApproved={() => { setActiveModal(null); handleLogin(activeModal.platformId); }}
          onClose={() => setActiveModal(null)}
        />
      )}

      <AppFooter />
    </div>
  );
}
