import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, setActiveAccount, type StoredAccount } from '../utils/accounts';
import { PLATFORM_COLORS, PLATFORM_LABELS, PLATFORM_ICONS } from '../utils/platform';

interface PlatformSwitcherSidebarProps {
  isOpen: boolean;
  activeUserId: string;
  onClose: () => void;
  // Called when the user picks a different account so Dashboard can re-fetch.
  onSwitch: (userId: string) => void;
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
}: PlatformSwitcherSidebarProps) {
  const accounts = getAccounts();
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close sidebar on Escape key
  useEffect(() => {
    if (!isOpen) return;
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
              const color = PLATFORM_COLORS[account.platform] ?? '#a855f7';
              const label = PLATFORM_LABELS[account.platform] ?? account.platform;
              const icon = PLATFORM_ICONS[account.platform] ?? '🎵';

              return (
                // Real <a> tag so middle-click / Ctrl+click opens a new tab.
                // href encodes the target userId so the new tab knows which account to activate.
                // Plain left-click calls handleSwitch() in-place and prevents the default
                // navigation — same behaviour as before.
                // Ctrl+click / Meta+click lets the browser open a new tab; we don't prevent
                // default so the URL carries the userId to Dashboard.
                <a
                  key={account.userId}
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
              );
            })
          )}
        </div>

        {/* Footer — connect another platform */}
        <div className="px-4 py-4 border-t border-border-color">
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
        </div>
      </div>
    </div>
  );
}
