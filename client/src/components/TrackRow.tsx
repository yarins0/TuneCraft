import type { Track } from '../api/tracks';
import { formatDuration } from '../api/tracks';
import { getPlatformTrackUrl, getPlatformLabel } from '../utils/platform';
import TrackAudioFeaturesCollapse from './TrackAudioFeaturesCollapse';

// The shape returned by useNumberStepper — used for the position jump input's stepper buttons
interface NumberStepper {
  increment: () => void;
  decrement: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

interface Props {
  track: Track;
  // 0-based index of this track in the current playlist
  index: number;
  // Total number of tracks — controls whether drag handles are shown
  totalTracks: number;
  // Whether this row's audio features panel is open
  isOpen: boolean;
  // Whether this track is flagged as a duplicate — triggers red tint styling
  isDuplicate: boolean;
  // Index currently being hovered over during a drag — drives drop target highlight
  dragOverIndex: number | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  // Whether this row's position input is in edit mode
  isJumping: boolean;
  // Current value of the position input while in edit mode
  jumpInputValue: string;
  jumpStepper: NumberStepper;
  onJumpInputChange: (val: string) => void;
  // Called when the user confirms a jump (Enter / blur) — parent applies the reorder
  onJumpConfirm: () => void;
  // Called when the user cancels a jump (Escape)
  onJumpCancel: () => void;
  // Called when the user double-clicks the position number to enter edit mode
  onJumpStart: () => void;
  // Toggles the audio features panel open/closed
  onToggleOpen: () => void;
}

// A single row in the playlist track list.
// Handles: drag-to-reorder, double-click position jump, audio feature expand/collapse.
export default function TrackRow({
  track,
  index,
  totalTracks,
  isOpen,
  isDuplicate,
  dragOverIndex,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isJumping,
  jumpInputValue,
  jumpStepper,
  onJumpInputChange,
  onJumpConfirm,
  onJumpCancel,
  onJumpStart,
  onToggleOpen,
}: Props) {
  const draggable = totalTracks > 1;

  return (
    <div
      className={[
        'group rounded-xl transition-colors duration-200',
        isDuplicate ? 'ring-1 ring-red-500/30 bg-red-500/5' : '',
        dragOverIndex === index ? 'bg-bg-card ring-1 ring-accent/30' : 'hover:bg-bg-card',
      ].filter(Boolean).join(' ')}
    >
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          'flex items-center gap-4 px-4 py-3',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        ].filter(Boolean).join(' ')}
      >
        {isJumping ? (
          // Edit mode — shown after a double-click on the position number.
          // onBlur and Enter both confirm the jump so the user can use either.
          <div className="flex items-center gap-0.5 shrink-0">
            <input
              type="text"
              inputMode="numeric"
              value={jumpInputValue}
              onChange={e => onJumpInputChange(e.target.value)}
              onBlur={onJumpConfirm}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') onJumpCancel();
                jumpStepper.handleKeyDown(e);
              }}
              className="w-8 text-center text-sm bg-transparent border-b border-accent text-accent focus:outline-none"
              autoFocus
            />
            {/* Custom ▲▼ stepper — ▲ moves earlier (smaller number), ▼ moves later */}
            <div className="flex flex-col">
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={jumpStepper.decrement}
                className="text-accent leading-none text-[10px] hover:text-accent-hover"
              >▲</button>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={jumpStepper.increment}
                className="text-accent leading-none text-[10px] hover:text-accent-hover"
              >▼</button>
            </div>
          </div>
        ) : (
          // Static mode — double-click to enter edit mode.
          // title gives a hint on hover so the interaction is discoverable.
          <span
            className="text-text-muted text-sm w-6 text-right shrink-0 cursor-pointer select-none"
            title="Double-click to jump to position"
            onDoubleClick={e => {
              e.stopPropagation();
              onJumpStart();
            }}
          >
            {index + 1}
          </span>
        )}

        <span
          className={[
            'text-text-muted w-6 text-center shrink-0 select-none',
            draggable ? 'opacity-60 group-hover:opacity-100' : 'opacity-30',
          ].join(' ')}
          title="Drag to reorder"
          aria-hidden="true"
        >
          ⋮⋮
        </span>

        {/* Double-clicking anywhere from the album art rightward toggles audio features */}
        <div
          className="flex items-center gap-4 flex-1 min-w-0"
          onDoubleClick={onToggleOpen}
        >
          <div className="w-10 h-10 rounded-md overflow-hidden bg-bg-secondary shrink-0">
            {track.albumImageUrl ? (
              <img
                src={track.albumImageUrl}
                alt={track.albumName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                🎵
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = getPlatformTrackUrl(track.platform, track.id);
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
              className="text-sm font-medium truncate text-left text-text-primary hover:text-accent hover:underline cursor-pointer"
              title={getPlatformLabel(track.platform)}
            >
              {track.name}
            </button>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-text-muted text-xs truncate">{track.artist}</p>
              {track.genres.slice(0, 2).map(genre => (
                <span
                  key={genre}
                  className="text-accent text-xs bg-accent/10 px-2 py-0.5 rounded-full shrink-0"
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>

          <span className="text-text-muted text-sm w-10 text-right shrink-0">
            {formatDuration(track.durationMs)}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleOpen();
            }}
            className="text-text-muted hover:text-text-primary transition-colors duration-200 shrink-0 w-10 text-right"
            aria-label={isOpen ? 'Hide audio features' : 'Show audio features'}
            title={isOpen ? 'Hide audio features' : 'Show audio features'}
          >
            <span
              className="inline-block transition-transform duration-300"
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              aria-hidden="true"
            >
              ▼
            </span>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="pl-24 pr-4 pb-3 pt-0">
          <TrackAudioFeaturesCollapse track={track} />
        </div>
      )}
    </div>
  );
}
