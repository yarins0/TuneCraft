import { useState, useEffect } from 'react';
import { splitTracks } from '../utils/splitPlaylist';
import type { SplitStrategy, SplitGroup } from '../utils/splitPlaylist';
import type { Track } from '../api/tracks';

interface Props {
  isOpen: boolean;
  playlistName: string;   // Used to prefix each new playlist name e.g. "My Playlist — Rock"
  tracks: Track[];        // The full loaded track list from PlaylistDetail
  isLoading: boolean;
  onClose: () => void;
  // Called when the user confirms — receives the computed groups with a prefix applied to each name
  onConfirm: (groups: SplitGroup[]) => void;
}

// Describes each strategy option shown in the picker
const STRATEGIES: { value: SplitStrategy; label: string; description: string; emoji: string }[] = [
  {
    value: 'genre',
    label: 'Genre',
    description: 'One playlist per genre tag',
    emoji: '🎸',
  },
  {
    value: 'artist',
    label: 'Artist',
    description: 'One playlist per artist',
    emoji: '🎤',
  },
  {
    value: 'era',
    label: 'Era',
    description: 'One playlist per decade',
    emoji: '📅',
  },
  {
    value: 'energy',
    label: 'Energy',
    description: 'low / medium / high',
    emoji: '⚡',
  },
  {
    value: 'danceability',
    label: 'Danceability',
    description: 'low / medium / high',
    emoji: '💃',
  },
  {
    value: 'valence',
    label: 'Valence',
    description: 'low / medium / high',
    emoji: '😊',
  },
  {
    value: 'acousticness',
    label: 'Acousticness',
    description: 'low / medium / high',
    emoji: '🎻',
  },
  {
    value: 'instrumentalness',
    label: 'Instrumentalness',
    description: 'low / medium / high',
    emoji: '🎼',
  },
  {
    value: 'speechiness',
    label: 'Speechiness',
    description: 'low / medium / high',
    emoji: '🗣️',
  },
  {
    value: 'tempo',
    label: 'Tempo',
    description: 'chill / groove / upbeat / high',
    emoji: '⏱️',
  },
];

export default function SplitModal({
  isOpen,
  playlistName,
  tracks,
  isLoading,
  onClose,
  onConfirm,
}: Props) {
  const [strategy, setStrategy] = useState<SplitStrategy>('genre');
  // groups is recomputed every time the strategy changes — it's the live preview
  const [groups, setGroups] = useState<SplitGroup[]>([]);

  // Recompute the groups whenever the modal opens or the strategy changes
  useEffect(() => {
    if (isOpen && tracks.length > 0) {
      setGroups(splitTracks(tracks, strategy));
    }
  }, [isOpen, strategy, tracks]);

  // Reset strategy to default when modal opens
  useEffect(() => {
    if (isOpen) setStrategy('genre');
  }, [isOpen]);

  if (!isOpen) return null;

  // Prefixes each group name with the source playlist name
  // e.g. strategy = genre, group = "Rock" → "My Playlist — Rock"
  const namedGroups = groups.map(g => ({
    ...g,
    name: `${playlistName} — ${g.name}`,
  }));

  // Only groups with at least 1 track are included
  // (edge case: a strategy bucket could theoretically be empty)
  const validGroups = namedGroups.filter(g => g.tracks.length > 0);

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      {/* Modal panel */}
      <div
        className="bg-bg-card border border-border-color rounded-2xl p-6 w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-text-primary">✂️ Split Playlist</h2>
            <p className="text-text-muted text-sm mt-1">
              Divide <span className="text-text-primary font-medium">{playlistName}</span> into smaller playlists
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            ✕
          </button>
        </div>

        {/* Strategy picker */}
        <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-3 shrink-0">
          Split by
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5 shrink-0">
          {STRATEGIES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStrategy(s.value)}
              className={[
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-150',
                strategy === s.value
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border-color bg-bg-secondary hover:border-accent/40 text-text-muted',
              ].join(' ')}
            >
              <span className="text-xl shrink-0">{s.emoji}</span>
              <div>
                <p className="text-sm font-semibold leading-tight">{s.label}</p>
                <p className="text-xs text-text-muted leading-tight mt-0.5">{s.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Group preview — scrollable so large splits don't overflow the modal */}
        <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-2 shrink-0">
          Preview — {validGroups.length} playlists will be created
        </p>
        <div className="overflow-y-auto flex-1 rounded-xl border border-border-color bg-bg-secondary">
          {validGroups.length === 0 ? (
            <p className="text-text-muted text-sm p-4 text-center">
              No groups found for this strategy
            </p>
          ) : (
            validGroups.map((group, index) => (
              <div
                key={group.name}
                className={[
                  'flex items-center justify-between px-4 py-3',
                  index < validGroups.length - 1 ? 'border-b border-border-color' : '',
                ].join(' ')}
              >
                <p className="text-sm text-text-primary font-medium truncate pr-4">{group.name}</p>
                <p className="text-xs text-text-muted shrink-0">{group.tracks.length} tracks</p>
              </div>
            ))
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-5 shrink-0">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 bg-bg-secondary hover:bg-bg-primary disabled:opacity-50 text-text-muted font-semibold py-3 rounded-full border border-border-color transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(validGroups)}
            disabled={isLoading || validGroups.length === 0}
            className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          >
            {isLoading ? 'Splitting...' : `Create ${validGroups.length} Playlists`}
          </button>
        </div>
      </div>
    </div>
  );
}
