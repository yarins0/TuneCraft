import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PLATFORM_LABELS } from '../utils/platform';
import type { getPlatformConfig } from '../utils/platform';

// Pill badge in two styles:
//
//   accent   (default) — accent-coloured border + background; used for page-category labels
//                        (e.g. "Contact", "Legal" on the static pages).
//   platform           — inline style colours the pill with the platform's brand colour;
//                        used for the platform badge in PlaylistDetail's header.
type BadgeProps =
  | { variant?: 'accent';    children: ReactNode }
  | { variant:  'platform';  style: CSSProperties; children: ReactNode };

export function Badge(props: BadgeProps) {
  if (props.variant === 'platform') {
    return (
      <span
        className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={props.style}
      >
        {props.children}
      </span>
    );
  }
  return (
    <span className="font-mono text-xs uppercase tracking-widest text-accent bg-accent/10 border border-border-color rounded-full px-3 py-1">
      {props.children}
    </span>
  );
}

// A ▼ chevron that rotates 180° when open — used for all collapsible toggles.
export default function ChevronDown({ isOpen, className = '' }: { isOpen: boolean; className?: string }) {
  return (
    <span
      className={`inline-block transition-transform duration-300 ${className}`.trim()}
      style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
      aria-hidden="true"
    >▼</span>
  );
}

// Small monospaced section counter displayed above an h2.
// Used on long-form content pages (e.g. PrivacyPolicy) to number major sections.
export function SectionLabel({ text }: { text: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-widest text-accent opacity-80 mb-3">
      {text}
    </p>
  );
}

// Thin accent-coloured horizontal rule — fades from accent to transparent.
// Used as a visual break between major page sections.
export function Divider() {
  return (
    <div
      className="my-12"
      style={{
        height: 1,
        background: 'linear-gradient(90deg, var(--color-accent) 0%, transparent 80%)',
        opacity: 0.4,
      }}
    />
  );
}

// Standard card container: solid dark background, rounded corners, border.
// Used for bullet-list blocks on content pages.
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg-card border border-border-color rounded-2xl p-6 mt-5">
      {children}
    </div>
  );
}

// Bulleted list item with an accent em-dash marker.
// Used inside Card components on content pages.
export function BulletItem({ text }: { text: string }) {
  return (
    <li className="relative pl-5 text-text-muted text-sm leading-relaxed">
      <span className="absolute left-0 text-accent opacity-60">—</span>
      {text}
    </li>
  );
}

// Card with a subtle purple gradient background — used for highlighted contact/info blocks.
// Pass `className` to control padding and margin per usage (e.g. "p-8" or "p-7 mt-5").
export function AccentCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`border border-border-color rounded-2xl ${className}`.trim()}
      style={{ background: 'linear-gradient(135deg, var(--color-accent-subtle), var(--color-accent-faint))' }}
    >
      {children}
    </div>
  );
}

// Round overlay checkbox for playlist card cover images.
// Hover-reveals in normal mode; stays always-visible once selectMode is active.
// The space-key handler mirrors the click so keyboard users can toggle without a mouse.
export function SelectionCheckbox({
  isSelected,
  selectMode,
  ariaLabel,
  onSelect,
}: {
  isSelected: boolean;
  selectMode: boolean;
  ariaLabel: string;
  onSelect: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={isSelected}
      aria-label={ariaLabel}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => e.key === ' ' && onSelect(e as unknown as React.MouseEvent)}
      className={[
        'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150',
        isSelected ? 'bg-accent border-accent opacity-100' : 'bg-black/40 border-white/60',
        selectMode ? 'opacity-100' : 'sm:opacity-0 sm:group-hover:opacity-100',
      ].join(' ')}
    >
      {isSelected && <span className="text-text-primary text-xs font-bold leading-none">✓</span>}
    </div>
  );
}

// Full-page screen shown when the playlist belongs to a different platform than the active account.
// Detected before any API call — prevents a confusing 404 or auth error.
export function PlatformMismatchScreen({
  playlistPlatform,
  activeAccountPlatform,
}: {
  playlistPlatform: string;
  activeAccountPlatform: string;
}) {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <p className="text-4xl mb-4">🔄</p>
        <p className="text-text-primary text-lg font-semibold mb-2">Wrong Platform</p>
        <p className="text-text-muted text-sm mb-6">
          This playlist is from{' '}
          <span className="text-text-primary font-medium">
            {PLATFORM_LABELS[playlistPlatform] ?? playlistPlatform}
          </span>
          , but you're currently logged in with{' '}
          <span className="text-text-primary font-medium">
            {PLATFORM_LABELS[activeAccountPlatform] ?? activeAccountPlatform}
          </span>
          . Switch accounts on the dashboard to view this playlist.
        </p>
        <Link
          to="/dashboard"
          className="bg-accent hover:bg-accent-hover text-text-primary font-semibold px-6 py-3 rounded-full transition-all duration-200 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// Full-page loading state shown while the first page of playlist tracks is being fetched.
export function PlaylistLoadingScreen() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading playlist...</div>
    </div>
  );
}

// Full-page error state shown when the playlist API call fails.
// Distinguishes between ownership-restriction errors and generic failures.
export function PlaylistErrorScreen({
  isOwner,
  platformConfig,
  error,
}: {
  isOwner: boolean;
  platformConfig: ReturnType<typeof getPlatformConfig>;
  error: string;
}) {
  // ownershipRestricted is a per-platform flag in the platform config — no string comparison needed
  const isOwnershipBlocked = !isOwner && platformConfig.ownershipRestricted;

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <p className="text-4xl mb-4">{isOwnershipBlocked ? '🔒' : '⚠️'}</p>
        <p className="text-text-primary text-lg font-semibold mb-2">
          {isOwnershipBlocked ? 'Playlist Unavailable' : 'Something went wrong'}
        </p>
        <p className="text-text-muted text-sm mb-2">{error}</p>
        {isOwnershipBlocked && (
          <p className="text-text-muted text-sm mb-4">
            {platformConfig.label} restricts access to playlists owned by other users.
          </p>
        )}
        {/* Cross-platform hint — shown whenever the error is not an ownership restriction. */}
        {!isOwnershipBlocked && (
          <p className="text-text-muted text-sm mb-6">
            If this playlist belongs to a different platform than the one you're currently logged into,
            try switching accounts on the dashboard.
          </p>
        )}
        <Link
          to="/dashboard"
          className="bg-accent hover:bg-accent-hover text-text-primary font-semibold px-6 py-3 rounded-full transition-all duration-200 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// Fixed bottom-centre toast for transient feedback messages.
// Renders nothing when message is null — safe to render unconditionally.
// Error variant uses the app's warning design token rather than a hardcoded colour.
export function Toast({ variant, message }: { variant: 'success' | 'error'; message: string | null }) {
  if (!message) return null;
  if (variant === 'success') {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent text-text-primary px-6 py-3 rounded-full shadow-lg z-50">
        ✅ {message}
      </div>
    );
  }
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 toast-error-bg text-text-primary px-6 py-3 rounded-full z-50 text-center max-w-md">
      ⚠️ {message}
    </div>
  );
}
