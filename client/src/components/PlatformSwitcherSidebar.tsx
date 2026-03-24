import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAccounts, setActiveAccount, removeAccount, type StoredAccount } from '../utils/accounts';
import { PLATFORM_COLORS, PLATFORM_LABELS, PLATFORM_ICONS } from '../utils/platform';

interface PlatformSwitcherSidebarProps {
  isOpen: boolean;
  activeUserId: string;
  onClose: () => void;
  // Called when the user picks a different account so Dashboard can re-fetch.
  onSwitch: (userId: string) => void;
  // Called after an account is removed so the parent can update its own state
  // (e.g. switch active userId). Optional — the sidebar handles redirect-to-login
  // when no accounts remain, but the parent may need to reset other state.
  onAccountRemoved?: (removedUserId: string) => void;
}

// PlatformSwitcherSidebar — slide-in sidebar from the right of the Dashboard header.
//
// Shows every connected account as a card. Tapping an account card:
//   1. Updates activeUserId in localStorage via setActiveAccount()
//   2. Calls onSwitch(userId) so Dashboard re-fetches the correct library
//   3. Closes the sidebar
//
// "Connect another platform" navigates to /login so the user can add a second account.
// The backdrop click closes the sidebar without switching.
export default function PlatformSwitcherSidebar({
  isOpen,
  activeUserId,
  onClose,
  onSwitch,
  onAccountRemoved,
}: PlatformSwitcherSidebarProps) {
  // Local copy of the accounts list so removing an account re-renders the sidebar
  // immediately without needing to close and reopen it.
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => getAccounts());

  // The userId whose removal is pending inline confirmation (null = none pending).
  // Clicking "Remove" once shows the confirmation line; clicking it again confirms.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  // Controls whether the per-card "Remove account" buttons are visible.
  // Hidden by default — the user must opt in via "- Remove a platform" in the footer.
  const [removeMode, setRemoveMode] = useState(false);

  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Re-sync the local accounts list each time the sidebar opens, so any changes
  // made from another tab (unlikely but possible) are reflected.
  useEffect(() => {
    if (isOpen) setAccounts(getAccounts());
  }, [isOpen]);

  // Close sidebar on Escape key.
  // Also clears any pending confirmation so it doesn't persist if the sidebar is
  // reopened later.
  useEffect(() => {
    if (!isOpen) {
      setConfirmingRemoveId(null);
      setRemoveMode(false);
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Close sidebar on backdrop mousedown (not click, to avoid closing on text-drag)
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const handleSwitch = (account: StoredAccount) => {
    if (account.userId === activeUserId) {
      onClose();
      return;
    }
    setActiveAccount(account.userId);
    onSwitch(account.userId);
    onClose();
  };

  // Handles the confirmed removal of an account.
  //
  // Flow:
  //   1. Call removeAccount() — hits DELETE /auth/:userId and cleans up localStorage.
  //   2. Update local state so the card disappears immediately without a page reload.
  //   3. If there are still other accounts, activate the first remaining one
  //      and notify the parent via onAccountRemoved(). The parent is responsible
  //      for updating its own activeUserId state.
  //   4. If no accounts remain, close the sidebar and redirect to login.
  const handleRemoveConfirm = async (userId: string) => {
    await removeAccount(userId);

    // Re-read from localStorage rather than filtering the stale React state closure.
    // removeAccount() already wrote the updated array to localStorage, so getAccounts()
    // returns the authoritative post-removal list regardless of any intermediate re-renders.
    const remaining = getAccounts();
    setAccounts(remaining);
    setConfirmingRemoveId(null);
    // Exit remove mode once an account is actually removed — the destructive action
    // is complete, no need to keep the remove buttons visible.
    if (remaining.length > 0) setRemoveMode(false);

    onAccountRemoved?.(userId);

    if (remaining.length === 0) {
      // No accounts left — the session is empty, send the user to login.
      onClose();
      navigate('/');
    } else if (userId === activeUserId) {
      // The active account was removed — switch to the first remaining one so
      // the dashboard doesn't silently render with a stale userId.
      const next = remaining[0];
      setActiveAccount(next.userId);
      onSwitch(next.userId);
      onClose();
    }
  };

  return (
    // Full-screen backdrop dims the dashboard while the sidebar is open
    <div
      className="fixed inset-0 bg-black/50 z-50"
      onMouseDown={handleBackdropMouseDown}
      aria-modal="true"
      role="dialog"
      aria-label="Switch platform account"
    >
      {/* Sidebar panel — fixed to the right edge of the screen */}
      <div
        ref={sidebarRef}
        className="absolute top-0 right-0 h-full w-80 bg-bg-card border-l border-border-color
                   flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Your Accounts
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg"
            aria-label="Close account switcher"
          >
            ✕
          </button>
        </div>

        {/* Account list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-3">
          {accounts.length === 0 ? (
            // Empty state — shouldn't happen (user is logged in) but defensive
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <span className="text-4xl">🎵</span>
              <p className="text-text-primary font-semibold text-sm">No accounts connected</p>
              <p className="text-text-muted text-xs">Go to Login to connect a platform.</p>
            </div>
          ) : (
            accounts.map(account => {
              const isActive = account.userId === activeUserId;
              const isConfirming = confirmingRemoveId === account.userId;
              const color = PLATFORM_COLORS[account.platform] ?? '#a855f7';
              const label = PLATFORM_LABELS[account.platform] ?? account.platform;
              const icon = PLATFORM_ICONS[account.platform] ?? '🎵';

              return (
                // Outer wrapper div groups the clickable account card and the remove button
                // as siblings. A <button> cannot be a descendant of <a> (invalid HTML), so
                // wrapping both in a div and making them siblings is the correct pattern here.
                <div key={account.userId} className="flex flex-col gap-1">
                  {/* Real <a> tag so middle-click / Ctrl+click opens a new tab.
                      href encodes the target userId so the new tab knows which account to activate.
                      Plain left-click calls handleSwitch() in-place and prevents the default
                      navigation — same behaviour as before.
                      Ctrl+click / Meta+click lets the browser open a new tab; we don't prevent
                      default so the URL carries the userId to Dashboard. */}
                  <a
                    href={`/dashboard?switchTo=${account.userId}`}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        handleSwitch(account);
                      }
                    }}
                    className={`
                      w-full flex items-center gap-4 px-4 py-3 rounded-xl border text-left
                      transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                      ${isActive
                        ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
                        : 'border-border-color bg-bg-secondary hover:border-accent/40'
                      }
                    `}
                    aria-label={`Switch to ${label} account${account.displayName ? ` (${account.displayName})` : ''}`}
                  >
                    {/* Platform colour dot / avatar */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
                        border: `2px solid ${color}`,
                      }}
                    >
                      {icon}
                    </div>

                    {/* Account info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary font-semibold text-sm truncate">
                        {account.displayName || label}
                      </p>
                      <p className="text-text-muted text-xs">{label}</p>
                    </div>

                    {/* Active indicator */}
                    {isActive && (
                      <span className="text-accent text-xs font-semibold shrink-0">Active</span>
                    )}
                  </a>

                  {/* Remove account row — only visible when the user has opted in via
                      "- Remove a platform" in the footer. Shows a first-click "Remove"
                      button per card, then an inline confirmation before committing. */}
                  {removeMode && isConfirming ? (
                    // Confirmation state: show a destructive confirm button and a cancel link
                    <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30">
                      <span className="text-xs text-red-400">
                        Remove {label} account?
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setConfirmingRemoveId(null)}
                          className="text-xs text-text-muted hover:text-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRemoveConfirm(account.userId)}
                          className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  ) : removeMode ? (
                    // Remove mode active, not yet confirming: show the per-card remove button
                    <button
                      onClick={() => setConfirmingRemoveId(account.userId)}
                      className="self-end text-xs text-text-muted hover:text-red-400 transition-colors px-2 py-0.5 rounded"
                    >
                      Remove account
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* Footer — connect another platform + optional remove mode toggle */}
        <div className="px-4 py-4 border-t border-border-color flex flex-col gap-2">
          {/* <Link> renders as a real <a> tag, enabling middle-click and Ctrl+click
              to open the login page in a new tab. onClick still closes the sidebar
              on a regular left-click so the UX is unchanged for that case. */}
          <Link
            to="/"
            onClick={onClose}
            className="block w-full text-center bg-bg-secondary hover:bg-bg-primary border border-border-color
                       hover:border-accent/50 text-text-primary font-semibold px-5 py-2 rounded-full
                       transition-all duration-200 hover:scale-105 active:scale-95 text-sm"
          >
            + Connect another platform
          </Link>

          {/* Toggles remove mode — reveals per-card "Remove account" buttons.
              Hidden when only one account is connected (nothing to switch to after removal
              would be handled, but still allowed — the sidebar handles the empty state). */}
          <button
            onClick={() => {
              setRemoveMode(prev => !prev);
              setConfirmingRemoveId(null);
            }}
            className={`w-full text-center px-5 py-2 rounded-full text-sm transition-all duration-200
              hover:scale-105 active:scale-95
              ${removeMode
                ? 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'text-text-muted hover:text-red-400 hover:shadow-[0_0_12px_var(--color-warning-glow)]'
              }`}
          >
            {removeMode ? '✕ Cancel' : '− Remove a platform'}
          </button>
        </div>
      </div>
    </div>
  );
}
