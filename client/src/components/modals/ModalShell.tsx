import { useEffect, useRef } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // ID of the heading element inside the modal — consumed by aria-labelledby
  labelId: string;
  // Additional classes applied to the panel div (sizing, overflow, etc.)
  panelClassName?: string;
  children: React.ReactNode;
}

// Shared modal shell — handles backdrop, click/touch-to-close, ARIA dialog role, and focus trap.
// Every modal in the app should use this instead of duplicating the boilerplate.
export default function ModalShell({ isOpen, onClose, labelId, panelClassName = '', children }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);

  // Traps keyboard focus inside the open modal.
  // Cycles Tab/Shift+Tab through focusable elements; Escape closes.
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const getFocusable = () => Array.from(
      modalRef.current!.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    getFocusable()[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onMouseDown={e => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
      onTouchEnd={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={`bg-bg-card border border-border-color rounded-2xl ${panelClassName}`.trim()}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
