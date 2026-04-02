import { Link } from 'react-router-dom';
import { getActiveAccount } from '../utils/accounts';

// Builds the dashboard URL encoding the active userId so middle-click / Ctrl+click
// opens a new tab on the correct platform instead of falling back to localStorage.
const dashboardUrl = () => `/dashboard?switchTo=${getActiveAccount()?.userId || ''}`;

type Props =
  | { variant: 'hero' | 'header' | 'compact' }
  | { variant: 'back'; onClick: () => void };

// Renders the TuneCraft wordmark in four configurations:
//
//   hero    — Login page: large, not a link, centred tagline below
//   header  — Dashboard header: medium, Link, tagline visible
//   compact — PlaylistDetail header: small, Link, no tagline, text hidden on mobile
//   back    — Contact / Privacy Policy: text-only button that navigates back
export default function AppLogo(props: Props) {
  // Check `back` first so TypeScript can narrow `props` and access `props.onClick` without a cast.
  if (props.variant === 'back') {
    return (
      <button
        onClick={props.onClick}
        className="inline-block text-2xl font-black tracking-tight mb-12 transition-all duration-200 hover:scale-105 active:scale-95"
      >
        Tune<span className="text-accent">Craft</span>
      </button>
    );
  }

  const { variant } = props;

  if (variant === 'hero') {
    return (
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
    );
  }

  if (variant === 'header') {
    return (
      <Link to={dashboardUrl()} className="flex items-center gap-3 cursor-pointer w-fit">
        <img src="/favicon.svg" alt="TuneCraft icon" className="h-12 w-12" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Tune<span className="text-accent">Craft</span>
          </h1>
          <p className="text-text-muted text-sm mt-0.5">Your music, engineered.</p>
        </div>
      </Link>
    );
  }

  // compact — used in PlaylistDetail's sticky header alongside the playlist title
  return (
    <Link to={dashboardUrl()} className="flex items-center gap-2 cursor-pointer shrink-0">
      <img src="/favicon.svg" alt="TuneCraft icon" className="h-7 w-7" />
      <h1 className="hidden sm:block text-2xl font-bold tracking-tight">
        Tune<span className="text-accent">Craft</span>
      </h1>
    </Link>
  );
}
