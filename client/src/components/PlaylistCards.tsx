import { Link } from 'react-router-dom';
import type { Playlist } from '../api/playlists';
import { SelectionCheckbox } from './ui';

// ─── PlaylistCard ─────────────────────────────────────────────────────────────

// Renders one API-backed playlist card in the library grid.
// Used by both "Your Library" (owned) and "Following" sections.
//
// selectable         — false on platforms where ownership restrictions block merge
//                      selection (e.g. Spotify followed playlists). Dims the card
//                      and disables the checkbox.
// showFollowingBadge — overlays a "Following" label on the cover image (bottom-left).
export function PlaylistCard({
  playlist,
  to,
  state,
  isSelected,
  selectMode,
  onClick,
  onCheckboxClick,
  selectable = true,
  showFollowingBadge = false,
}: {
  playlist: Playlist;
  to: string;
  state: object;
  isSelected: boolean;
  selectMode: boolean;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxClick: (e: React.MouseEvent, id: string) => void;
  selectable?: boolean;
  showFollowingBadge?: boolean;
}) {
  const linkClass = [
    'group bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 block',
    selectable
      ? [
          'relative cursor-pointer',
          isSelected
            ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
            : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
        ].join(' ')
      : [
          'border-border-color',
          selectMode
            ? 'opacity-30 cursor-not-allowed'
            : 'opacity-75 hover:border-accent/50 hover:bg-bg-secondary cursor-pointer',
        ].join(' '),
  ].join(' ');

  return (
    <Link to={to} state={state} onClick={onClick} className={linkClass}>
      {/* Image area — relative so the badge and checkbox can be absolutely positioned */}
      <div className="aspect-square w-full bg-bg-secondary overflow-hidden relative">
        {showFollowingBadge && (
          <div className="absolute left-2 top-2 z-10 pointer-events-none">
            <div className="bg-bg-card text-accent text-[11px] font-semibold px-2.5 py-1 rounded-md shadow-lg">
              Following
            </div>
          </div>
        )}
        {selectable && (
          <SelectionCheckbox
            isSelected={isSelected}
            selectMode={selectMode}
            ariaLabel={`Select ${playlist.name} for merge`}
            onSelect={e => onCheckboxClick(e, playlist.platformId)}
          />
        )}
        {playlist.imageUrl ? (
          <img src={playlist.imageUrl} alt={playlist.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">🎵</div>
        )}
      </div>
      <div className="p-4">
        <p className="font-semibold text-sm truncate">{playlist.name}</p>
        <p className="text-text-muted text-xs mt-1">{playlist.trackCount} tracks</p>
      </div>
    </Link>
  );
}

// ─── LikedSongsCard ───────────────────────────────────────────────────────────

// Fixed card representing the Liked Songs library — always selectable, always first in the grid.
// Visually distinct from PlaylistCard: gradient cover background and a static 💜 emoji
// instead of a dynamic playlist image.
// Receives pre-built `to` and `state` as props so routing logic stays in the parent.
export function LikedSongsCard({
  to,
  state,
  likedCount,
  isSelected,
  selectMode,
  onCardClick,
  onCheckboxClick,
}: {
  to: string;
  state: object;
  likedCount: number | null;
  isSelected: boolean;
  selectMode: boolean;
  onCardClick: (e: React.MouseEvent) => void;
  onCheckboxClick: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      to={to}
      state={state}
      onClick={onCardClick}
      className={[
        'group relative bg-bg-card rounded-2xl overflow-hidden border transition-all duration-200 cursor-pointer block',
        isSelected
          ? 'border-accent ring-2 ring-accent/40 bg-accent/5'
          : 'border-border-color hover:border-accent/50 hover:bg-bg-secondary',
      ].join(' ')}
    >
      <div className="aspect-square w-full bg-gradient-to-br from-purple-900 to-accent/30 flex items-center justify-center relative">
        <SelectionCheckbox
          isSelected={isSelected}
          selectMode={selectMode}
          ariaLabel="Select Liked Songs for merge"
          onSelect={onCheckboxClick}
        />
        <span className="text-8xl">💜</span>
      </div>
      <div className="p-4">
        <p className="font-semibold text-sm">Liked Songs</p>
        <p className="text-text-muted text-xs mt-1">{likedCount ?? '...'} tracks</p>
      </div>
    </Link>
  );
}
