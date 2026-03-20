import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../api/config';

// Redirects the user to the selected platform's OAuth login flow via the Tunecraft backend.
// The platform query param tells the server which adapter to use.
const handleLogin = (platform: string) => {
  window.location.href = `${API_BASE_URL}/auth/login?platform=${platform}`;
};

// Each platform option in the picker.
// `color` uses the platform's official brand color for the active button so users recognise
// what they're granting access to — a trust signal before the OAuth redirect.
const PLATFORMS = [
  { id: 'SPOTIFY',     label: 'Spotify',     available: true,  color: '#1DB954' },
  { id: 'SOUNDCLOUD',  label: 'SoundCloud',  available: true,  color: '#FF5500' },
  { id: 'TIDAL',       label: 'Tidal',       available: true,  color: '#00FFFF' },
  { id: 'APPLE_MUSIC', label: 'Apple Music', available: false, color: '#fc3c44' },
];

export default function Login() {
  // The OAuth callback redirects back here with ?error=denied when the user cancels
  // the authorization screen on Spotify or SoundCloud. Show a brief explanatory message
  // so they're not confused by the page reloading with no feedback.
  const denied = new URLSearchParams(window.location.search).get('error') === 'denied';

  return (
    <div className="relative min-h-screen bg-bg-primary flex items-center justify-center">
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
              onClick={available ? () => handleLogin(id) : undefined}
              disabled={!available}
              title={available ? undefined : 'Coming soon'}
              style={available ? { backgroundColor: color } : undefined}
              className={
                available
                  ? 'text-white font-bold px-10 py-4 rounded-full text-lg transition-all duration-300 hover:scale-105 active:scale-95 hover:brightness-110'
                  : 'bg-bg-secondary text-text-muted font-bold px-10 py-4 rounded-full text-lg opacity-40 cursor-not-allowed relative'
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

      {/* Privacy link at the bottom of the page — only visible when the page is scrolled/expanded */}
      <Link
        to="/privacy"
        className="absolute bottom-4 left-0 right-0 text-center text-text-muted text-xs hover:text-text-primary transition-colors duration-200"
      >
        Privacy Policy
      </Link>
    </div>
  );
}
