import { useState } from 'react';
import ModalShell from './ModalShell';
import { API_BASE_URL } from '../../api/config';
import { useAnimatedLabel } from '../../hooks/useAnimatedLabel';
import type { AccessRequestConfig } from '../../utils/platform/types';

// The modal has three screens that the user moves through in order:
//   choice  — explains the platform's dev-mode limit and asks which situation applies
//   form    — collects the user's name and platform-linked email
//   success — confirms the request was sent and sets expectations
type Screen = 'choice' | 'form' | 'success';

interface Props {
  // Internal platform key (e.g. 'SPOTIFY', 'YOUTUBE') — used to route the request to
  // the correct server endpoint: POST /auth/{platform}/request-access
  platformId: string;
  // Human-readable platform name for button labels and headings (e.g. 'Spotify')
  platformLabel: string;
  // CSS color value for the primary action button — uses the platform's brand colour
  platformColor: string;
  // Platform-specific strings for the modal UI
  config: AccessRequestConfig;
  // Called when the user confirms they are already approved — triggers the normal OAuth redirect
  onApproved: () => void;
  // Called when the user clicks the backdrop or close button to dismiss without acting
  onClose: () => void;
}

export default function AccessRequestModal({
  platformId,
  platformLabel,
  platformColor,
  config,
  onApproved,
  onClose,
}: Props) {
  const [screen, setScreen]       = useState<Screen>('choice');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [error, setError]         = useState('');
  const [isLoading, setisLoading]     = useState(false);
  const sendLabel = useAnimatedLabel(isLoading, 'Sending');

  // Submits the access request to the server, which saves it to the DB and emails the admin.
  // Routes to /auth/{platform}/request-access using the lowercased platform ID.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setisLoading(true);

    const endpoint = `${API_BASE_URL}/auth/${platformId.toLowerCase()}/request-access`;

    try {
      const res = await fetch(endpoint, {
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
      setisLoading(false);
    }
  };

  return (
    <ModalShell isOpen={true} onClose={onClose} labelId="access-modal-title" panelClassName="relative p-8 w-full max-w-md shadow-2xl">
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
              <h2 id="access-modal-title" className="text-xl font-bold text-text-primary mb-2">
                {platformLabel} Access Required
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                {config.description}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {/* Already approved path — skips the form and goes straight to OAuth */}
              <button
                onClick={onApproved}
                style={{ backgroundColor: platformColor }}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-black hover:brightness-110 active:scale-95 transition-all"
              >
                I've been approved — {config.continueLabel}
              </button>

              {/* New / removed path — shows the request form */}
              <button
                onClick={() => setScreen('form')}
                className="w-full py-3 px-4 rounded-xl font-semibold text-sm border border-border-color text-text-primary hover:bg-surface-hover active:scale-95 transition-all"
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
              <h2 id="access-modal-title" className="text-xl font-bold text-text-primary mb-2">
                Request Access
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                Enter your name and the email address linked to your {platformLabel} account.
                We'll review your request and add you manually — you'll be able to log in
                once approved.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-row gap-2 w-full">
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
                    className="w-full bg-bg-primary border border-border-color rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
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
                    className="w-full bg-bg-primary border border-border-color rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-text-muted text-xs font-medium uppercase tracking-wide">
                  {config.emailLabel}
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
                className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border-color text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-accent text-black hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? sendLabel : 'Send Request'}
              </button>
            </div>
          </form>
        )}

        {/* ── Screen: success ─────────────────────────────────────────────── */}
        {screen === 'success' && (
          <div className="flex flex-col gap-6 text-center">
            <div>
              <div className="text-4xl mb-3">✉️</div>
              <h2 id="access-modal-title" className="text-xl font-bold text-text-primary mb-2">
                Request Sent
              </h2>
              <p className="text-text-muted text-sm leading-relaxed">
                Your request has been received. Once you're added to the allowlist
                you'll be able to log in with {platformLabel} — this is a manual
                process so it may take a short while.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-semibold border border-border-color text-text-primary hover:bg-surface-hover active:scale-95 transition-all"
            >
              Close
            </button>
          </div>
        )}
    </ModalShell>
  );
}
