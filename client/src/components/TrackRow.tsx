import type { Track } from '../api/tracks';
import { formatDuration } from '../api/tracks';
import { getPlatformTrackUrl, getPlatformLabel } from '../utils/platform';
import TrackAudioFeaturesCollapse from './TrackAudioFeaturesCollapse';
import ChevronDown from './ui';

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
  // Whether this row is the active drag source — triggers dim/scale visual feedback
  isDragging: boolean;
  // Index currently being hovered over during a drag — drives drop target highlight
  dragOverIndex: number | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  // Touch drag — fires on each touchmove with the finger's client coordinates
  onTouchDragMove: (clientX: number, clientY: number) => void;
  // Called on touchend — parent reads current drag state and applies the reorder
  onTouchDrop: () => void;
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
  isDragging,
  dragOverIndex,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onTouchDragMove,
  onTouchDrop,
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
      data-track-index={String(index)}
      className={[
        'group rounded-xl transition-all duration-200',
        isDuplicate ? 'ring-1 ring-red-500/30 bg-red-500/5' : '',
        dragOverIndex === index ? 'bg-bg-card ring-1 ring-accent/30' : 'hover:bg-bg-card',
        isDragging ? 'opacity-50 scale-95' : '',
      ].filter(Boolean).join(' ')}
    >
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3"
      >
        {/* Combined drag handle + position number.
            Both desktop drag and mobile touch drag originate here, so grabbing either
            the ⋮⋮ icon or the number initiates a reorder.
            touch-none prevents page scroll when a drag starts from this area. */}
        <div
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onTouchStart={() => { if (draggable) onDragStart(); }}
          onTouchMove={draggable ? (e) => {
            const t = e.touches[0];
            if (t) onTouchDragMove(t.clientX, t.clientY);
          } : undefined}
          onTouchEnd={draggable ? () => onTouchDrop() : undefined}
          className={[
            'flex items-center gap-0 shrink-0',
            draggable ? 'cursor-grab active:cursor-grabbing touch-none select-none' : '',
          ].filter(Boolean).join(' ')}
        >
          {draggable && (
            <span
              className="text-text-muted text-xs opacity-60 group-hover:opacity-100"
              aria-hidden="true"
            >⋮⋮</span>
          )}

          {isJumping ? (
            // Edit mode — shown after tapping/double-clicking the position number.
            // onBlur and Enter both confirm the jump so the user can use either.
            <div className="flex items-center gap-0.5">
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
            // Static mode — tap (mobile) or double-click (desktop) to enter edit mode.
            // Pointer type check distinguishes touch from mouse so each gets its natural interaction.
            <span
              className="text-text-muted text-sm w-6 text-right cursor-pointer -ml-2"
              title="Tap or double-click to jump to position"
              onClick={e => {
                if (!window.matchMedia('(pointer: coarse)').matches) return;
                e.stopPropagation();
                onJumpStart();
              }}
              onDoubleClick={e => {
                if (window.matchMedia('(pointer: coarse)').matches) return;
                e.stopPropagation();
                onJumpStart();
              }}
            >
              {index + 1}
            </span>
          )}
        </div>

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

          {/* Mobile layout: track name + artist on a single line */}
          <div className="sm:hidden flex flex-col min-w-0 flex-1">
            <a
              href={getPlatformTrackUrl(track.platform, track.id)}
              target="_blank"
              rel="noopener noreferrer"
              onDoubleClick={e => e.stopPropagation()}
              className="text-sm font-medium truncate block text-text-primary hover:text-accent hover:underline cursor-pointer"
              title={getPlatformLabel(track.platform)}
            >
              {track.name}
              <span className="text-text-muted font-normal"> — {track.artist}</span>
            </a>
            {track.genres.length > 0 && (
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {track.genres.slice(0, 2).map(genre => (
                  <span key={genre} className="text-accent text-xs bg-accent/10 px-1.5 py-0.5 rounded-full shrink-0">
                    {genre}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Desktop layout: three-column grid — Track | Artist | Album */}
          <div className="hidden sm:grid sm:grid-cols-[2fr_1fr_1fr] gap-x-4 flex-1 min-w-0 items-start">
            <div className="min-w-0">
              <a
                href={getPlatformTrackUrl(track.platform, track.id)}
                target="_blank"
                rel="noopener noreferrer"
                onDoubleClick={e => e.stopPropagation()}
                className="text-sm font-medium truncate block text-text-primary hover:text-accent hover:underline cursor-pointer"
                title={getPlatformLabel(track.platform)}
              >
                {track.name}
              </a>
              {track.genres.length > 0 && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {track.genres.slice(0, 4).map(genre => (
                    <span key={genre} className="text-accent text-xs bg-accent/10 px-2 py-0.5 rounded-full shrink-0">
                      {genre}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-text-muted text-xs truncate pt-0.5">{track.artist}</p>
            <p className="text-text-muted text-xs truncate pt-0.5">{track.albumName || '—'}</p>
          </div>

          <span className="hidden sm:inline-block text-text-muted text-sm w-10 text-right shrink-0">
            {formatDuration(track.durationMs)}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleOpen();
            }}
            className="text-text-muted hover:text-text-primary transition-colors duration-200 shrink-0 w-11 text-right"
            aria-label={isOpen ? 'Hide audio features' : 'Show audio features'}
            title={isOpen ? 'Hide audio features' : 'Show audio features'}
          >
            <ChevronDown isOpen={isOpen} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="pl-9 sm:pl-24 pr-4 pb-3 pt-0">
          <TrackAudioFeaturesCollapse track={track} />
        </div>
      )}
    </div>
  );
}
