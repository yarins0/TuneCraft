import { Link } from 'react-router-dom';

// Shared site footer — rendered at the bottom of every page.
// Contains copyright, attribution, and links to legal/contact pages.
export default function AppFooter() {
  return (
    <footer className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 px-5 py-2 border-t border-border-color bg-bg-primary">
      {/* Metadata — lowest visual priority */}
      <p className="font-mono text-xs text-text-muted">
        © 2026 TuneCraft · Built with ♪ by Yarin Solomon
      </p>

      {/* Links — slightly more prominent than metadata, these are the interactive elements */}
      <div className="flex gap-4">
        <Link to="/contact" className="text-xs text-text-primary/60 hover:text-text-primary transition-all duration-200 py-1">
          Contact
        </Link>
        <Link to="/privacy" className="text-xs text-text-primary/60 hover:text-text-primary transition-all duration-200 py-1">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
