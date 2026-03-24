import { useRef, useState } from 'react';
import { API_BASE_URL } from '../api/config';

// Spotify enforces this hard cap on developer-mode apps.
// Update this value if Spotify changes their policy.
const SPOTIFY_DEV_USER_LIMIT = 5;

// The modal has three screens that the user moves through in order:
//   choice  — explains the Spotify dev-mode limit and asks which situation applies
//   form    — collects the user's name and Spotify-linked email
//   success — confirms the request was sent and sets expectations
type Screen = 'choice' | 'form' | 'success';

interface Props {
  // Called when the user confirms they are already approved — triggers the normal OAuth redirect.
  onApproved: () => void;
  // Called when the user clicks the backdrop or the close button to dismiss without acting.
  onClose: () => void;
}

export default function SpotifyAccessModal({ onApproved, onClose }: Props) {
  const [screen, setScreen]   = useState<Screen>('choice');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  // Tracks whether the mousedown originated on the backdrop.
  // Prevents closing the modal when the user drags from inside the card and releases outside.
  const mouseDownOnBackdrop = useRef(false);

  // Submits the access request to the server, which saves it to the DB and emails the admin.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/spotify/request-access`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firstName, lastName, email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setScreen('success');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Backdrop — clicking outside the card dismisses the modal
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onMouseDown={e => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
    >
      {/* Card — stop click from bubbling to backdrop */}
      <div
        className="relative bg-bg-card border border-border-color rounded-2xl p-8 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
        >
          ✕
        </button>

        {/* ── Screen: choice ─────────────────────────────────────────────── */}
        {screen === 'choice' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-2">
                Spotify Access Required
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                Tunecraft is currently in developer mode. Spotify limits developer apps
                to {SPOTIFY_DEV_USER_LIMIT} approved users — only people manually added
                to the allowlist can log in.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {/* Already approved path — skips the form and goes straight to OAuth */}
              <button
                onClick={onApproved}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-[#1DB954] text-black hover:brightness-110 active:scale-95 transition-all"
              >
                I've been approved — continue to Spotify
              </button>

              {/* New / removed path — shows the request form */}
              <button
                onClick={() => setScreen('form')}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm border border-border-color text-text-primary hover:bg-white/5 active:scale-95 transition-all"
              >
                I'm new or I've been removed — request access
              </button>
            </div>
          </div>
        )}

        {/* ── Screen: form ───────────────────────────────────────────────── */}
        {screen === 'form' && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-2">
                Request Access
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                Enter the name and email address linked to your Spotify account.
                We'll review your request and add you manually — you'll be able
                to log in once approved.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-text-muted text-xs font-medium uppercase tracking-wide">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="First"
                    required
                    className="bg-bg-primary border border-border-color rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-text-muted text-xs font-medium uppercase tracking-wide">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="Last"
                    required
                    className="bg-bg-primary border border-border-color rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-text-muted text-xs font-medium uppercase tracking-wide">
                  Spotify Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                  className="bg-bg-primary border border-border-color rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setScreen('choice')}
                className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border-color text-text-muted hover:text-text-primary hover:bg-white/5 active:scale-95 transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-accent text-black hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </form>
        )}

        {/* ── Screen: success ─────────────────────────────────────────────── */}
        {screen === 'success' && (
          <div className="flex flex-col gap-6 text-center">
            <div>
              <div className="text-4xl mb-3">✉️</div>
              <h2 className="text-xl font-bold text-text-primary mb-2">
                Request Sent
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                Your request has been received. Once you're added to the allowlist
                you'll be able to log in with Spotify — this is a manual process
                so it may take a short while.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-semibold border border-border-color text-text-primary hover:bg-white/5 active:scale-95 transition-all"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
