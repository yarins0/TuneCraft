import type { ReactNode } from 'react';
import AppFooter from './AppFooter';

// Shared page layout for static content pages (Contact, PrivacyPolicy).
// Renders the fixed decorative background layers (grid texture + glow blob)
// and the site footer. Children are responsible for their own content container
// and must include `relative z-10` to layer above the fixed backgrounds.
export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary relative flex flex-col">

      {/* Subtle purple grid texture */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(168,85,247,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top-centre glow blob */}
      <div
        className="fixed pointer-events-none z-0"
        style={{
          top: -200,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 800,
          height: 500,
          background: 'radial-gradient(ellipse, rgba(168,85,247,0.08) 0%, transparent 70%)',
        }}
      />

      {children}

      <div className="relative z-10">
        <AppFooter />
      </div>
    </div>
  );
}
