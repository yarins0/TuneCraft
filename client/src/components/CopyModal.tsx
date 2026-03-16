import { useState, useEffect, useRef } from 'react';
import { useAnimatedLabel } from '../hooks/useAnimatedLabel';

interface Props {
  isOpen: boolean;
  defaultName: string;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export default function CopyModal({ isOpen, defaultName, isLoading, onClose, onConfirm }: Props) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Animates the confirm button label while the copy request is in flight
  const saveLabel = useAnimatedLabel(isLoading, 'Saveing');

  // Sync the input value whenever the modal opens with a new default name
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      // Auto-focus the input so the user can start typing immediately
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    // Backdrop — clicking outside cancels the copy
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      {/* Modal panel — stop click from bubbling to backdrop */}
      <div
        className="bg-bg-card border border-border-color rounded-2xl p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-text-primary">💾 Save as Copy</h2>
            <p className="text-text-muted text-sm mt-1">Choose a name for your new playlist</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Name input */}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          placeholder="Playlist name..."
          className="w-full bg-bg-secondary border border-border-color rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors duration-200 mb-6"
        />

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 bg-bg-secondary hover:bg-bg-primary disabled:opacity-50 text-text-muted font-semibold py-3 rounded-full border border-border-color transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || !name.trim()}
            className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}