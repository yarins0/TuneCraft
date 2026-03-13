// client/src/components/MergeModal.tsx
import React, { useEffect, useState } from 'react';
import type { Playlist } from '../api/playlists';

type MergeModalProps = {
  isOpen: boolean;
  selectedPlaylists: Playlist[];
  likedSongsSelected: boolean;
  likedCount: number | null;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (name: string, removeDuplicates: boolean) => void;
};

const MergeModal: React.FC<MergeModalProps> = ({
  isOpen,
  selectedPlaylists,
  likedSongsSelected,
  likedCount,
  isLoading,
  onClose,
  onConfirm,
}) => {
  const [name, setName] = useState('');
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [mergeLabelIndex, setMergeLabelIndex] = useState(0);

  const mergeLabels = ['Merging.', 'Merging..', 'Merging...'];

  useEffect(() => {
    if (!isLoading) {
      setMergeLabelIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setMergeLabelIndex(prev => (prev + 1) % mergeLabels.length);
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [isLoading]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(name.trim() || 'Merged Playlist (By TuneCraft)', removeDuplicates);
  };

  const selectionSummary = [
    ...(likedSongsSelected ? ['Liked Songs'] : []),
    ...selectedPlaylists.map(p => p.name),
  ].join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-2xl bg-bg-card p-6 shadow-2xl border border-border-color">
        <h2 className="text-xl font-semibold mb-2">Merge playlists</h2>
        <p className="text-text-muted text-sm mb-4">
          You&apos;re about to merge the following:
        </p>
        <p className="text-sm mb-3 truncate">{selectionSummary}</p>
        {likedSongsSelected && (
          <p className="text-xs text-text-muted mb-4">
            Liked Songs{likedCount != null ? ` · ${likedCount} tracks` : ''}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              New playlist name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Merged playlist name..."
              className="w-full bg-bg-secondary border border-border-color rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/60"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={removeDuplicates}
              onChange={e => setRemoveDuplicates(e.target.checked)}
              className="w-4 h-4 rounded border-border-color text-accent focus:ring-accent"
            />
            <span>Remove duplicate tracks</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm rounded-full border border-border-color bg-bg-secondary text-text-muted hover:bg-bg-primary disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 text-sm rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-60 disabled:cursor-wait"
            >
              {isLoading ? mergeLabels[mergeLabelIndex] : 'Merge playlists'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MergeModal;