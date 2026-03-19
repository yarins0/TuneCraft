import type { Track } from '../api/tracks';

// A single entry returned by findDuplicates:
//   track         — the duplicate track object
//   index         — its position in the current tracks array (0-based)
//   originalIndex — position of the first occurrence (0-based)
export interface DuplicateEntry {
  track: Track;
  index: number;
  originalIndex: number;
}

interface Props {
  duplicates: DuplicateEntry[];
  // Whether the list is expanded beyond the first 3 rows
  isDupesExpanded: boolean;
  onToggleExpand: () => void;
  // Remove a single duplicate by its index in the tracks array
  onRemove: (index: number) => void;
  // Remove all duplicate occurrences at once
  onRemoveAll: () => void;
}

// Shown at the top of the track list when the playlist contains repeated tracks.
// Always shows the first 3 duplicates; the rest are hidden behind a "Show more" toggle.
export default function DuplicatesWarning({
  duplicates,
  isDupesExpanded,
  onToggleExpand,
  onRemove,
  onRemoveAll,
}: Props) {
  return (
    <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl overflow-hidden">

      {/* Header row with count + remove all button */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-red-500/20">
        <span className="text-red-400 text-sm font-semibold uppercase tracking-widest">
          ⚠️ {duplicates.length} duplicate{duplicates.length > 1 ? 's' : ''} found
        </span>
        <button
          type="button"
          onClick={onRemoveAll}
          className="text-red-400 hover:text-red-300 text-xs font-semibold uppercase tracking-wide transition-colors"
        >
          🗑️ Remove all
        </button>
      </div>

      {/* Duplicate rows — always show first 3, rest hidden until expanded */}
      <div className="flex flex-col divide-y divide-red-500/10">
        {(isDupesExpanded ? duplicates : duplicates.slice(0, 3)).map(({ track, index, originalIndex }) => (
          <div
            key={`dup-${index}`}
            className="flex items-center gap-4 px-5 py-3"
          >
            {/* Album art */}
            <div className="w-9 h-9 rounded-md overflow-hidden bg-bg-secondary shrink-0">
              {track.albumImageUrl ? (
                <img src={track.albumImageUrl} alt={track.albumName} className="w-full h-full object-cover opacity-70" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-muted">🎵</div>
              )}
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-300 truncate">{track.name}</p>
              <p className="text-xs text-red-400/70 truncate">
                {track.artist} · duplicate of track #{originalIndex + 1} · appears at #{index + 1}
              </p>
            </div>

            {/* Remove this duplicate button */}
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="text-red-400 hover:text-red-200 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-red-500/20 text-sm"
              title="Remove this duplicate"
              aria-label={`Remove duplicate of ${track.name}`}
            >
              🗑️
            </button>
          </div>
        ))}
      </div>

      {/* Show more / show less toggle — only rendered when there are more than 3 duplicates */}
      {duplicates.length > 3 && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full px-5 py-2.5 text-xs text-red-400/80 hover:text-red-300 font-semibold uppercase tracking-wide transition-colors border-t border-red-500/20 hover:bg-red-500/10"
        >
          {isDupesExpanded ? '▲ Show less' : `▼ Show ${duplicates.length - 3} more`}
        </button>
      )}
    </div>
  );
}
