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
