import { API_BASE_URL } from '../api/config';

// Redirects the user to the selected platform's OAuth login flow via the Tunecraft backend.
// The platform query param tells the server which adapter to use.
const handleLogin = (platform: string) => {
  window.location.href = `${API_BASE_URL}/auth/login?platform=${platform}`;
};

// Each platform option in the picker.
// `available` controls whether the button is clickable — only Spotify is live right now.
const PLATFORMS = [
  { id: 'SPOTIFY',     label: 'Spotify',     available: true  },
  { id: 'SOUNDCLOUD',  label: 'SoundCloud',  available: false },
  { id: 'APPLE_MUSIC', label: 'Apple Music', available: false },
];

export default function Login() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
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

        {/* Platform picker */}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {PLATFORMS.map(({ id, label, available }) => (
            <button
              key={id}
              onClick={available ? () => handleLogin(id) : undefined}
              disabled={!available}
              title={available ? undefined : 'Coming soon'}
              className={
                available
                  ? 'bg-accent hover:bg-accent-hover text-text-primary font-bold px-10 py-4 rounded-full text-lg transition-all duration-300 hover:scale-105 active:scale-95'
                  : 'bg-bg-secondary text-text-muted font-bold px-10 py-4 rounded-full text-lg opacity-40 cursor-not-allowed'
              }
            >
              Connect {label}
            </button>
          ))}
        </div>

        <p className="text-text-muted text-xs">
          Tunecraft never stores your passwords.
        </p>
      </div>
    </div>
  );
}
