import { useNavigate, Link } from 'react-router-dom';
import AppLogo from '../components/AppLogo';
import PageShell from '../components/PageShell';
import { Badge, SectionLabel, Divider, Card, BulletItem, AccentCard } from '../components/ui';
import { getAllPlatformConfigs } from '../utils/platform';


// Derived from the platform registry — stays in sync automatically when platforms are added.
const AVAILABLE_PLATFORMS = getAllPlatformConfigs().map(p => ({
  label:     p.label,
  comingSoon: !p.available,
}));

// Metadata for each data type TuneCraft stores.
// Rendered as a table so users can scan what's collected, where, and why at a glance.
const DATA_COLLECTED = [
  {
    data: 'OAuth access & refresh tokens',
    stored: 'TuneCraft server database',
    purpose: 'Authenticating API requests to connected platforms on your behalf, including background jobs like auto-reshuffle',
  },
  {
    data: 'Display name & email address',
    stored: 'TuneCraft server database',
    purpose: 'Pulled from your platform profile at login. Email is optional and only stored if the platform provides it',
  },
  {
    data: 'Platform user ID',
    stored: 'TuneCraft database + browser localStorage',
    purpose: 'Identifying your account across sessions',
  },
  {
    data: 'Auto-reshuffle schedule config',
    stored: 'TuneCraft database (Neon / PostgreSQL)',
    purpose: 'Storing which playlists to reshuffle, how often, and which algorithms to apply',
  },
  {
    data: 'Track & artist metadata cache',
    stored: 'TuneCraft database',
    purpose: 'Reducing repeat API calls for audio features and genre data. Contains no personal information',
  },
];

// Things TuneCraft explicitly does NOT collect — important for user trust.
const NOT_COLLECTED = [
  'We do not store your passwords — authentication is handled entirely by each platform\'s OAuth flow',
  'We do not sell, share, or monetise any data',
  'We do not use tracking cookies or run analytics on user behaviour',
  'We do not serve advertisements of any kind',
  'We do not collect payment information — TuneCraft is free and non-commercial',
];

// Controls the user has over their own data.
const USER_CONTROLS = [
  'Revoke TuneCraft\'s access to your Spotify, SoundCloud, Tidal, or YouTube account at any time via each platform\'s connected apps settings',
  'Log out of TuneCraft at any time to clear your session tokens from your browser',
  'Request deletion of any data TuneCraft holds about you by contacting us (see below)',
  'Disable any active reshuffle schedules directly from within the app',
];

// Third-party APIs that receive anonymised track or artist identifiers — never personal data.
const THIRD_PARTY_APIS = [
  { name: 'ReccoBeats', desc: 'Audio feature data (energy, danceability, tempo, etc.)' },
  { name: 'Last.fm', desc: 'Artist genre tags' },
  { name: 'Songstats', desc: 'Cross-platform track metadata (pending API access)' },
];

// Each numbered section of the policy. Rendered in order.
// `label` is the monospaced section counter shown above the heading.
const SECTIONS = [
  { id: 'overview', label: '01 / Overview' },
  { id: 'integrations', label: '02 / Integrations' },
  { id: 'collection', label: '03 / Data collection' },
  { id: 'not-collected', label: '04 / What we don\'t do' },
  { id: 'third-party', label: '05 / Third-party services' },
  { id: 'retention', label: '06 / Retention' },
  { id: 'rights', label: '07 / Your rights' },
  { id: 'hosting', label: '08 / Infrastructure' },
  { id: 'changes', label: '09 / Updates' },
  { id: 'contact', label: '10 / Contact' },
];

export default function PrivacyPolicy() {
  // navigate(-1) sends the user back to wherever they came from (Login or Dashboard).
  // Falls back to "/" if the user landed directly on this page with no prior history.
  const navigate = useNavigate();
  const handleBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  return (
    <PageShell>
      {/* Page content — constrained to readable width */}
      <div className="relative z-10 max-w-[760px] mx-auto px-6 py-16 pb-24">

        {/* ── Header ── */}
        <header className="mb-16">
          <AppLogo variant="back" onClick={handleBack} />

          {/* "Legal" badge — matches accent pill pattern */}
          <div className="inline-flex mb-5 ml-3">
            <Badge>Legal</Badge>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-none mb-4">
            Privacy Policy
          </h1>
          <p className="font-mono text-xs text-text-muted">
            Last updated: March 2026 · Effective immediately
          </p>
        </header>

        <Divider />

        {/* ── 01 Overview ── */}
        <section className="mb-12" id={SECTIONS[0].id}>
          <SectionLabel text={SECTIONS[0].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Who we are</h2>
          <p className="text-text-muted text-sm leading-relaxed mb-3">
            TuneCraft ("we", "our", or "the app") is a personal music engineering web application
            that helps users manage, analyse, and reorganise their playlists across music platforms.
            TuneCraft is a non-commercial portfolio project, not a commercial product or service.
          </p>
          <p className="text-text-muted text-sm leading-relaxed">
            This Privacy Policy explains what information TuneCraft collects, how it is used,
            and what controls you have over your data.
          </p>
        </section>

        {/* ── 02 Integrations ── */}
        <section className="mb-12" id={SECTIONS[1].id}>
          <SectionLabel text={SECTIONS[1].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Platform integrations</h2>
          <p className="text-text-muted text-sm leading-relaxed mb-4">
            TuneCraft currently integrates with the following third-party platforms:
          </p>

          {/* Platform tags — styled like the secondary ghost button variant. */}
          <div className="flex flex-wrap gap-2 mb-4">
            {AVAILABLE_PLATFORMS.map(({ label, comingSoon }) => (
              <span
                key={label}
                className="relative font-mono text-sm px-4 py-1.5 rounded-lg bg-bg-secondary border border-border-color text-text-primary"
              >
                {label}
                {comingSoon && (
                  <span className="absolute -top-2 -right-2 text-[9px] font-semibold bg-bg-card border border-border-color text-text-muted px-1.5 py-0.5 rounded-full">
                    soon
                  </span>
                )}
              </span>
            ))}
          </div>

          <p className="text-text-muted text-sm leading-relaxed">
            Connecting a platform account grants TuneCraft read access to your library and playlists
            on that platform, as well as the ability to modify playlists you own.
            You can revoke this access at any time from within each platform's account settings.
          </p>
        </section>

        {/* ── 03 Data collection ── */}
        <section className="mb-12" id={SECTIONS[2].id}>
          <SectionLabel text={SECTIONS[2].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">What data TuneCraft collects</h2>

          {/* Data table — uses border-color tokens and muted text for secondary columns */}
          <div className="overflow-x-auto mt-5">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {['Data', 'Where it\'s stored', 'Purpose'].map((col) => (
                    <th
                      key={col}
                      className="font-mono text-xs uppercase tracking-widest text-text-muted text-left px-4 py-3 border-b border-border-color"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DATA_COLLECTED.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-semibold text-text-primary border-b border-white/5 align-top whitespace-nowrap">
                      {row.data}
                    </td>
                    <td className="px-4 py-3 text-text-muted border-b border-white/5 align-top">
                      {row.stored}
                    </td>
                    <td className="px-4 py-3 text-text-muted border-b border-white/5 align-top">
                      {row.purpose}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 04 What we don't collect ── */}
        <section className="mb-12" id={SECTIONS[3].id}>
          <SectionLabel text={SECTIONS[3].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">What TuneCraft does not collect</h2>
          <Card>
            <ul className="flex flex-col gap-3">
              {NOT_COLLECTED.map((item, i) => (
                <BulletItem key={i} text={item} />
              ))}
            </ul>
          </Card>
        </section>

        {/* ── 05 Third-party APIs ── */}
        <section className="mb-12" id={SECTIONS[4].id}>
          <SectionLabel text={SECTIONS[4].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Third-party APIs used</h2>
          <p className="text-text-muted text-sm leading-relaxed mb-1">
            TuneCraft uses the following external APIs to enrich track data. These are server-side
            calls — your personal data is never sent to these services:
          </p>
          <Card>
            <ul className="flex flex-col gap-3">
              {THIRD_PARTY_APIS.map((api) => (
                <li key={api.name} className="relative pl-5 text-text-muted text-sm leading-relaxed">
                  <span className="absolute left-0 text-accent opacity-60">—</span>
                  <span className="text-text-primary font-semibold">{api.name}</span>
                  {' '}— {api.desc}
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-text-muted text-sm leading-relaxed mt-4">
            Each of these services has their own privacy policy. TuneCraft only passes anonymised
            track or artist identifiers (e.g. Spotify track IDs) to these services — never your
            personal information.
          </p>
        </section>

        {/* ── 06 Retention ── */}
        <section className="mb-12" id={SECTIONS[5].id}>
          <SectionLabel text={SECTIONS[5].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">How long we keep your data</h2>
          <p className="text-text-muted text-sm leading-relaxed mb-3">
            OAuth tokens are stored on TuneCraft's server database so that background jobs
            (like auto-reshuffle) can act on your behalf without you being logged in.
            Logging out clears your browser session; to fully revoke access, disconnect
            TuneCraft from your platform's connected apps settings.
          </p>
          <p className="text-text-muted text-sm leading-relaxed mb-3">
            Reshuffle schedule records are stored in TuneCraft's database for as long as you have
            an active schedule enabled. Disabling a reshuffle schedule removes the associated record
            from the database immediately.
          </p>
          <p className="text-text-muted text-sm leading-relaxed">
            Cached track and artist metadata does not contain any personal information and is
            retained to improve performance. It can be cleared on request.
          </p>
        </section>

        {/* ── 07 Your rights ── */}
        <section className="mb-12" id={SECTIONS[6].id}>
          <SectionLabel text={SECTIONS[6].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Your controls</h2>
          <Card>
            <ul className="flex flex-col gap-3">
              {USER_CONTROLS.map((item, i) => (
                <BulletItem key={i} text={item} />
              ))}
            </ul>
          </Card>
        </section>

        {/* ── 08 Hosting ── */}
        <section className="mb-12" id={SECTIONS[7].id}>
          <SectionLabel text={SECTIONS[7].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Where TuneCraft is hosted</h2>
          <p className="text-text-muted text-sm leading-relaxed">
            TuneCraft's frontend is hosted on{' '}
            <span className="text-text-primary font-semibold">Vercel</span>.
            The backend API and database are hosted on{' '}
            <span className="text-text-primary font-semibold">Railway</span> or{' '}
            <span className="text-text-primary font-semibold">Render</span>,
            with the database managed via{' '}
            <span className="text-text-primary font-semibold">Neon (PostgreSQL)</span>.
            All services are located in the United States or European Union.
          </p>
        </section>

        {/* ── 09 Changes ── */}
        <section className="mb-12" id={SECTIONS[8].id}>
          <SectionLabel text={SECTIONS[8].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Changes to this policy</h2>
          <p className="text-text-muted text-sm leading-relaxed">
            As TuneCraft grows and adds new platform integrations, this Privacy Policy may be
            updated to reflect those changes. The "Last updated" date at the top of this page
            will always reflect the most recent revision.
          </p>
        </section>

        {/* ── 10 Contact ── */}
        <section className="mb-12" id={SECTIONS[9].id}>
          <SectionLabel text={SECTIONS[9].label} />
          <h2 className="text-xl font-bold tracking-tight mb-4">Questions?</h2>

          <AccentCard className="p-7 mt-5">
            <p className="text-text-muted text-sm leading-relaxed mb-2">
              TuneCraft is built and maintained by{' '}
              <span className="text-text-primary font-semibold">Yarin Solomon</span>.
            </p>
            <p className="text-text-muted text-sm leading-relaxed">
              If you have any questions about this Privacy Policy or want to request data deletion,
              visit our{' '}
              <Link to="/contact" className="text-accent hover:underline">
                Contact page
              </Link>
              .
            </p>
          </AccentCard>
        </section>

        <Divider />

      </div>
    </PageShell>
  );
}
