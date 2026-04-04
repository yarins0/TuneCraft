import { useState, useEffect, useRef } from 'react';
import ModalShell from './ModalShell';
import { splitTracks } from '../../utils/splitPlaylist';
import type { SplitStrategy, SplitGroup } from '../../utils/splitPlaylist';
import type { Track } from '../../api/tracks';
import { useAnimatedLabel } from '../../hooks/useAnimatedLabel';
import { MIN_AUDIO_FEATURE_COVERAGE } from '../../constants/audioFeatures';
import ChevronDown from '../ui';

interface Props {
  isOpen: boolean;
  playlistName: string;   // Used to prefix each new playlist name e.g. "My Playlist — Rock"
  tracks: Track[];        // The full loaded track list from PlaylistDetail
  isLoading: boolean;
  // Fraction (0–1) of tracks that have at least one non-null audio feature.
  // When below MIN_AUDIO_FEATURE_COVERAGE the audio-feature split strategies are disabled —
  // they'd produce meaningless groups if only a handful of tracks have feature data.
  audioFeatureCoverage?: number;
  onClose: () => void;
  // Called when the user confirms — receives only the checked groups, with final names applied
  onConfirm: (groups: SplitGroup[]) => void;
}

// Describes each strategy option shown in the picker
const STRATEGIES: { value: SplitStrategy; label: string; description: string; emoji: string }[] = [
  { value: 'genre',            label: 'Genre',            description: 'One playlist per genre tag',         emoji: '🎸' },
  { value: 'artist',           label: 'Artist',           description: 'One playlist per artist',            emoji: '🎤' },
  { value: 'era',              label: 'Era',              description: 'One playlist per decade',            emoji: '📅' },
  { value: 'energy',           label: 'Energy',           description: 'low / medium / high',                emoji: '⚡' },
  { value: 'danceability',     label: 'Danceability',     description: 'low / medium / high',                emoji: '💃' },
  { value: 'valence',          label: 'Valence',          description: 'low / medium / high',                emoji: '😊' },
  { value: 'acousticness',     label: 'Acousticness',     description: 'low / medium / high',                emoji: '🎻' },
  { value: 'instrumentalness', label: 'Instrumentalness', description: 'low / medium / high',                emoji: '🎼' },
  { value: 'speechiness',      label: 'Speechiness',      description: 'low / medium / high',                emoji: '🗣️' },
  { value: 'tempo',            label: 'Tempo',            description: 'chill / groove / upbeat / high',     emoji: '⏱️' },
];

// Strategies that require audio feature data (energy, danceability, etc.)
// These are disabled when fewer than 20% of tracks have feature data available.
const AUDIO_FEATURE_STRATEGIES = new Set<SplitStrategy>([
  'energy', 'danceability', 'valence', 'acousticness', 'instrumentalness', 'speechiness', 'tempo',
]);

// The action popover that appears on a track row inside an expanded group.
// Uses a two-level drill-down pattern:
//   Level 1 ("main"): shows Remove, Copy to…, Transfer to…
//   Level 2 ("copy" or "transfer"): shows the list of target groups + a Back button
// This keeps the initial menu compact and only reveals the group list when needed.
interface TrackActionPopoverProps {
  trackId: string;
  currentGroupName: string;
  otherGroups: SplitGroup[];
  onRemove: () => void;
  onCopy: (targetGroupName: string) => void;
  onTransfer: (targetGroupName: string) => void;
  onClose: () => void;
}

function TrackActionPopover({
  otherGroups,
  onRemove,
  onCopy,
  onTransfer,
  onClose,
}: TrackActionPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 'main' shows the three top-level actions.
  // 'copy' and 'transfer' show the group picker for the respective action.
  const [view, setView] = useState<'main' | 'copy' | 'transfer'>('main');

  // Close when clicking outside the popover
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={[
        'absolute right-0 top-8 z-20 bg-bg-card border border-border-color rounded-xl shadow-xl p-3',
        // Widen the popover on level 2 so the grid columns have enough room
        view === 'main' ? 'w-52' : otherGroups.length <= 3 ? 'w-52' : otherGroups.length <= 6 ? 'w-64' : 'w-80',
      ].join(' ')}
    >
      {/* Level 1 — main actions */}
      {view === 'main' && (
        <>
          {/* Remove — sends the track to the Unassigned bucket */}
          <button
            type="button"
            onClick={() => { onRemove(); onClose(); }}
            className="w-full text-left px-3 py-2 text-sm rounded-lg transition-colors action-destructive"
          >
            🗑️ Remove
          </button>

          {otherGroups.length > 0 && (
            <>
              <div className="border-t border-border-color my-2" />

              {/* Copy to… — drills into the copy group picker */}
              <button
                type="button"
                onClick={() => setView('copy')}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-secondary rounded-lg transition-colors flex items-center justify-between"
              >
                <span>📋 Copy to…</span>
                <span className="text-text-muted">›</span>
              </button>

              {/* Transfer to… — drills into the transfer group picker */}
              <button
                type="button"
                onClick={() => setView('transfer')}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-secondary rounded-lg transition-colors flex items-center justify-between"
              >
                <span>➡️ Transfer to…</span>
                <span className="text-text-muted">›</span>
              </button>
            </>
          )}
        </>
      )}

      {/* Level 2 — group picker for Copy or Transfer */}
      {(view === 'copy' || view === 'transfer') && (
        <>
          {/* Back button returns to the main action list */}
          <button
            type="button"
            onClick={() => setView('main')}
            className="w-full text-left px-3 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors flex items-center gap-2 mb-1"
          >
            <span>‹</span>
            <span>{view === 'copy' ? 'Copy to…' : 'Transfer to…'}</span>
          </button>

          <div className="border-t border-border-color my-2" />

          {/* Group grid — 1 col for ≤3, 2 cols for ≤6, 3 cols for 7+ */}
          <div className={otherGroups.length <= 3 ? 'flex flex-col' : otherGroups.length <= 6 ? 'grid grid-cols-2 gap-1' : 'grid grid-cols-3 gap-1'}>
            {otherGroups.map(g => (
              <button
                key={g.name}
                type="button"
                onClick={() => {
                  if (view === 'copy') onCopy(g.name);
                  else onTransfer(g.name);
                  onClose();
                }}
                className="text-left px-2 py-1.5 text-xs text-text-primary hover:bg-bg-secondary rounded-lg transition-colors truncate"
                title={g.name}
              >
                {g.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Tracks the naming state for each group in the split preview.
// Lives at module scope so it can be referenced by the pure helper functions below.
interface GroupMeta {
  // Original algorithm bucket names merged into this group — drives the description and merge formula.
  labels: string[];
  // What's shown in the UI and written to the platform as the playlist name.
  displayName: string;
  // True once the user commits a rename — changes how further merges build the display name.
  changed: boolean;
  // Platform playlist description. Always built from labels, unaffected by user renames.
  description: string;
}

// Reserved key for the overflow bucket — double-underscore prevents collision with real group names.
const UNASSIGNED = '__unassigned__';

// Generic Set toggle — returns a new Set with `item` added if absent, removed if present.
// Used by enabledGroups and expandedGroups click handlers to avoid duplicating the same 4-line pattern.
function toggleSetItem<T>(prev: Set<T>, item: T): Set<T> {
  const next = new Set(prev);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}

// Returns the display name for a group.
// Unassigned always renders as "Unassigned" — it cannot be renamed.
function resolvedName(
  groupName: string,
  groupMeta: Record<string, GroupMeta>,
  playlistName: string,
): string {
  if (groupName === UNASSIGNED) return 'Unassigned';
  return groupMeta[groupName]?.displayName ?? `${playlistName} — ${groupName}`;
}

// Builds the merged display name after combining a target group and a partner group.
// Formula: changed parts come first, then unchanged parts are grouped under the playlist prefix.
//   All changed  → "ChangedName1 + ChangedName2"
//   All pristine → "My Playlist — Rock + Blues + Jazz"
//   Mixed        → "ChangedName + My Playlist — Rock + Blues"
function buildMergedDisplayName(
  targetMeta: GroupMeta,
  partnerMeta: GroupMeta,
  playlistName: string,
): string {
  const parts = [
    { displayName: targetMeta.displayName, changed: targetMeta.changed, labels: targetMeta.labels },
    { displayName: partnerMeta.displayName, changed: partnerMeta.changed, labels: partnerMeta.labels },
  ];
  const changed = parts.filter(p => p.changed);
  const unchanged = parts.filter(p => !p.changed);

  const changedStr = changed.map(p => p.displayName).join(' + ');
  const unchangedStr = unchanged.length > 0
    ? `${playlistName} — ${unchanged.flatMap(p => p.labels).join(' + ')}`
    : '';

  if (changedStr && unchangedStr) return `${changedStr} + ${unchangedStr}`;
  if (changedStr) return changedStr;
  return unchangedStr;
}

// Builds the array of groups passed to onConfirm:
// filters to only checked groups and resolves each group's display name and description.
function buildConfirmPayload(
  validGroups: SplitGroup[],
  enabledGroups: Set<string>,
  groupMeta: Record<string, GroupMeta>,
  playlistName: string,
): SplitGroup[] {
  return validGroups
    .filter(g => enabledGroups.has(g.name))
    .map(g => ({
      ...g,
      name: resolvedName(g.name, groupMeta, playlistName),
      description: groupMeta[g.name]?.description ?? `${playlistName} — ${g.name}`,
    }));
}

// Left-column strategy picker — renders the ordered list of split-by buttons.
// Disabled buttons are shown for audio-feature strategies when coverage is too low.
function StrategyPicker({
  selected,
  audioFeatureCoverage,
  onSelect,
}: {
  selected: SplitStrategy;
  audioFeatureCoverage: number;
  onSelect: (s: SplitStrategy) => void;
}) {
  return (
    <div className="w-full sm:w-[24%] sm:shrink-0 flex flex-col min-h-0">
      <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-3 shrink-0">
        Split by
      </p>
      <div className="flex flex-row sm:flex-col gap-0.5 overflow-x-auto sm:overflow-y-auto custom-scrollbar pb-1 sm:pb-0">
        {STRATEGIES.map(s => {
          const isDisabled = AUDIO_FEATURE_STRATEGIES.has(s.value) && audioFeatureCoverage < MIN_AUDIO_FEATURE_COVERAGE;
          return (
            <button
              key={s.value}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onSelect(s.value)}
              title={isDisabled ? 'Audio features unavailable for most tracks in this playlist' : undefined}
              className={[
                'flex items-center gap-3 px-3 py-1 rounded-xl border text-left transition-all duration-150 shrink-0',
                isDisabled
                  ? 'border-border-color bg-bg-secondary text-text-muted opacity-35 cursor-not-allowed'
                  : selected === s.value
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border-color bg-bg-secondary hover:border-accent/40 text-text-muted',
              ].join(' ')}
            >
              <span className="text-xl shrink-0">{s.emoji}</span>
              <div>
                <p className="text-sm font-semibold leading-tight">{s.label}</p>
                <p className="hidden sm:block text-xs text-text-muted leading-tight mt-0.5">{s.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One row in the split preview — header bar + collapsible track list.
// Receives all derived flags and callbacks from SplitModal so that no state lives here.
interface GroupRowProps {
  group: SplitGroup;
  // True when this is the last visible row (suppresses the bottom border).
  isLast: boolean;
  isExpanded: boolean;
  isEnabled: boolean;
  isMergeMode: boolean;
  isTheMergeTarget: boolean;
  // The currently active merge target — needed to build the "Absorb into …" label.
  mergeTarget: string | null;
  editingGroupId: string | null;
  groupMeta: Record<string, GroupMeta>;
  openPopover: string | null;
  playlistName: string;
  // Other non-unassigned groups shown in the track action popover.
  otherGroups: SplitGroup[];
  onToggleEnabled: () => void;
  onStartEdit: () => void;
  onNameChange: (value: string) => void;
  // Commits the rename: marks the group as changed if the name differs from the default.
  onNameBlur: () => void;
  onToggleExpand: () => void;
  onStartMerge: () => void;
  // Absorbs this row's group into the current mergeTarget.
  onAbsorb: () => void;
  onCancelMerge: () => void;
  onRemoveTrack: (trackId: string) => void;
  onCopyTrack: (trackId: string, target: string) => void;
  onTransferTrack: (trackId: string, target: string) => void;
  // Sets the open popover key ("groupName::trackId") or null to close.
  onPopoverChange: (key: string | null) => void;
}

function GroupRow({
  group,
  isLast,
  isExpanded,
  isEnabled,
  isMergeMode,
  isTheMergeTarget,
  mergeTarget,
  editingGroupId,
  groupMeta,
  openPopover,
  playlistName,
  otherGroups,
  onToggleEnabled,
  onStartEdit,
  onNameChange,
  onNameBlur,
  onToggleExpand,
  onStartMerge,
  onAbsorb,
  onCancelMerge,
  onRemoveTrack,
  onCopyTrack,
  onTransferTrack,
  onPopoverChange,
}: GroupRowProps) {
  const isUnassigned = group.name === UNASSIGNED;
  const isEditing = editingGroupId === group.name;

  return (
    <div
      className={[
        'border-border-color',
        !isLast ? 'border-b' : '',
        isUnassigned ? 'bg-[color-mix(in_srgb,var(--color-unassigned)_5%,transparent)]' : '',
        isMergeMode && !isTheMergeTarget ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Group header row */}
      <div className="flex items-center gap-3 px-4 py-3">

        {/* Checkbox — controls whether this group is included in onConfirm.
            Unassigned starts unchecked; it's an overflow bucket, not a real playlist. */}
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={onToggleEnabled}
          className="w-4 h-4 accent-accent shrink-0 cursor-pointer"
          aria-label={`Include "${resolvedName(group.name, groupMeta, playlistName)}" in export`}
        />

        {/* Edit name pencil — hidden for Unassigned since its name is fixed */}
        {!isUnassigned && (
          <button
            type="button"
            onClick={onStartEdit}
            className="text-xs text-text-muted hover:text-text-primary shrink-0"
            title="Edit name"
            aria-label="Edit playlist name"
          >
            ✏️
          </button>
        )}

        {/* Name — inline editable for normal groups, fixed label for Unassigned */}
        {!isUnassigned && isEditing ? (
          <input
            type="text"
            value={groupMeta[group.name]?.displayName ?? `${playlistName} — ${group.name}`}
            onChange={e => onNameChange(e.target.value)}
            onBlur={onNameBlur}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="flex-1 min-w-0 bg-transparent border-b border-border-color text-sm text-text-primary focus:outline-none"
            autoFocus
          />
        ) : (
          <p
            className={[
              'flex-1 min-w-0 text-sm font-medium truncate',
              isUnassigned ? 'text-unassigned' : isEnabled ? 'text-text-primary' : 'text-text-muted line-through',
            ].join(' ')}
          >
            {isUnassigned ? '📥 Unassigned' : resolvedName(group.name, groupMeta, playlistName)}
          </p>
        )}

        {/* Track count */}
        <p className="text-xs text-text-muted shrink-0">{group.tracks.length} tracks</p>

        {/* Merge button — hidden for Unassigned, which can't be a merge target */}
        {!isMergeMode && !isUnassigned && (
          <button
            type="button"
            onClick={onStartMerge}
            className="hidden sm:block text-xs text-text-muted hover:text-accent px-2 py-1 rounded-lg border border-border-color hover:border-accent/40 transition-colors shrink-0"
            title="Merge another split into this one"
          >
            ⊕ Merge
          </button>
        )}

        {/* While in merge mode: show "pick a split to absorb" label on the target row */}
        {isTheMergeTarget && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-accent font-semibold">← pick a split to absorb</span>
            <button
              type="button"
              onClick={onCancelMerge}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        )}

        {/* While in merge mode: every non-target row gets an "Absorb into …" button */}
        {isMergeMode && !isTheMergeTarget && mergeTarget && (
          <button
            type="button"
            onClick={onAbsorb}
            className="hidden sm:block text-xs bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 px-2 py-1 rounded-lg transition-colors shrink-0"
          >
            Absorb into {resolvedName(mergeTarget, groupMeta, playlistName).split('—')[1]?.trim() || resolvedName(mergeTarget, groupMeta, playlistName)}
          </button>
        )}

        {/* Expand/collapse chevron */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-text-muted hover:text-text-primary shrink-0 w-6 text-center"
          aria-label={isExpanded ? 'Collapse tracks' : 'Expand tracks'}
        >
          <ChevronDown isOpen={isExpanded} />
        </button>
      </div>

      {/* Expanded track list */}
      {isExpanded && (
        <div className="border-t border-border-color bg-bg-primary/40">
          {group.tracks.length === 0 ? (
            <p className="text-text-muted text-xs px-10 py-3 italic">No tracks left in this split</p>
          ) : (
            group.tracks.map(track => {
              const popoverKey = `${group.name}::${track.id}`;
              const isPopoverOpen = openPopover === popoverKey;

              return (
                <div
                  key={track.id}
                  className="flex items-center gap-3 px-4 sm:px-10 py-2 hover:bg-bg-card/50 transition-colors border-b border-border-color last:border-b-0"
                >
                  {/* Album art thumbnail */}
                  <div className="w-7 h-7 rounded overflow-hidden bg-bg-secondary shrink-0">
                    {track.albumImageUrl ? (
                      <img src={track.albumImageUrl} alt={track.albumName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs">🎵</div>
                    )}
                  </div>

                  {/* Track name + artist */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{track.name}</p>
                    <p className="text-xs text-text-muted truncate">{track.artist}</p>
                  </div>

                  {/* Three-dot action button + popover */}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => onPopoverChange(isPopoverOpen ? null : popoverKey)}
                      className="text-text-muted hover:text-text-primary text-sm px-1 rounded transition-colors"
                      aria-label="Track actions"
                      title="Track actions"
                    >
                      ⋯
                    </button>

                    {isPopoverOpen && (
                      <TrackActionPopover
                        trackId={track.id}
                        currentGroupName={group.name}
                        otherGroups={otherGroups}
                        onRemove={() => onRemoveTrack(track.id)}
                        onCopy={target => onCopyTrack(track.id, target)}
                        onTransfer={target => onTransferTrack(track.id, target)}
                        onClose={() => onPopoverChange(null)}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function SplitModal({
  isOpen,
  playlistName,
  tracks,
  isLoading,
  audioFeatureCoverage = 1,
  onClose,
  onConfirm,
}: Props) {
  const [strategy, setStrategy] = useState<SplitStrategy>('genre');

  // groups holds the live, mutable state of the split preview.
  // The user can add/remove tracks and merge groups — all changes live here.
  const [groups, setGroups] = useState<SplitGroup[]>([]);

  // groupMeta is the single source of truth for each group's naming state.
  // See the GroupMeta interface (module scope) for field documentation.
  const [groupMeta, setGroupMeta] = useState<Record<string, GroupMeta>>({});

  // editingGroupId tracks which group name input is currently being edited
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // enabledGroups is the set of group names whose checkbox is checked.
  // Only checked groups are passed to onConfirm.
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(new Set());

  // expandedGroups is the set of group names that are currently showing their track list
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // mergeTarget is the name of the group currently in "pick merge partners" mode.
  // When set, every other group row shows a "Merge into [target]" button.
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  // openPopover tracks which [groupName, trackId] combo has its action popover open.
  // Stored as a string key "groupName::trackId" for simplicity.
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  // Animates the confirm button label while the API call is in flight
  const splitLabel = useAnimatedLabel(isLoading, 'Splitting');


  // Recompute groups (and reset all interaction state) when the strategy changes or the modal opens
  useEffect(() => {
    if (isOpen && tracks.length > 0) {
      const computed = splitTracks(tracks, strategy);
      setGroups(computed);
      // Seed groupMeta from the fresh algorithm output.
      // Each group starts with a single label, an auto-generated displayName, and changed=false.
      setGroupMeta(Object.fromEntries(
        computed.map(g => [g.name, {
          labels: [g.name],
          displayName: `${playlistName} — ${g.name}`,
          changed: false,
          description: `${playlistName} — ${g.name}`,
        }])
      ));
      // Default: all groups are checked
      setEnabledGroups(new Set(computed.map(g => g.name)));
      // Collapse all groups on strategy change
      setExpandedGroups(new Set());
      setMergeTarget(null);
      setOpenPopover(null);
    }
  }, [isOpen, strategy, tracks]);

  // Reset UI state when modal opens fresh.
  // Audio-feature strategies are always reset to 'genre' — even if the user previously
  // selected an AF strategy, opening the modal again on a low-coverage playlist should
  // not leave them staring at a disabled selection with no indication of what happened.
  useEffect(() => {
    if (isOpen) {
      setStrategy(prev =>
        AUDIO_FEATURE_STRATEGIES.has(prev) && audioFeatureCoverage < MIN_AUDIO_FEATURE_COVERAGE ? 'genre' : prev
      );
      // groupMeta is intentionally NOT cleared here — effect 1 already resets it whenever
      // isOpen or strategy changes. Clearing it here caused a second render on first open
      // where groupMeta was empty, making names render before the flex container was
      // measured and breaking truncation for the initial genres view.
      setEditingGroupId(null);
      setMergeTarget(null);
      setOpenPopover(null);
    }
  }, [isOpen, audioFeatureCoverage]);

  if (!isOpen) return null;

  // Only groups with at least one track are shown.
  // The Unassigned bucket is always pinned to the end of the list.
  const validGroups = [
    ...groups.filter(g => g.tracks.length > 0 && g.name !== UNASSIGNED),
    ...groups.filter(g => g.name === UNASSIGNED && g.tracks.length > 0),
  ];

  // --- Track mutation helpers ---

  // Removes a track from a group and routes it to the Unassigned bucket.
  // If the Unassigned group doesn't exist yet, it is created on the fly.
  // If the track is already in Unassigned, it is not duplicated.
  const removeTrack = (groupName: string, trackId: string) => {
    setGroups(prev => {
      const sourceGroup = prev.find(g => g.name === groupName);
      const track = sourceGroup?.tracks.find(t => t.id === trackId);
      if (!track) return prev;

      // Remove the track from its source group
      const withoutTrack = prev.map(g =>
        g.name === groupName
          ? { ...g, tracks: g.tracks.filter(t => t.id !== trackId) }
          : g
      );

      const existingUnassigned = withoutTrack.find(g => g.name === UNASSIGNED);

      if (existingUnassigned) {
        if (existingUnassigned.tracks.some(t => t.id === track.id)) return withoutTrack;
        return withoutTrack.map(g =>
          g.name === UNASSIGNED ? { ...g, tracks: [...g.tracks, track] } : g
        );
      } else {
        // First removal ever — create the Unassigned group at the bottom of the list
        return [...withoutTrack, { name: UNASSIGNED, tracks: [track] }];
      }
    });
  };

  // Copies a track from its current group into a target group.
  // The track stays in the source group and also appears in the target.
  // Skips the copy if the track already exists in the target (avoids duplicates).
  const copyTrack = (sourceGroupName: string, trackId: string, targetGroupName: string) => {
    setGroups(prev => {
      const sourceGroup = prev.find(g => g.name === sourceGroupName);
      const track = sourceGroup?.tracks.find(t => t.id === trackId);
      if (!track) return prev;

      return prev.map(g => {
        if (g.name !== targetGroupName) return g;
        // Guard: don't add a duplicate
        if (g.tracks.some(t => t.id === track.id)) return g;
        return { ...g, tracks: [...g.tracks, track] };
      });
    });
  };

  // Moves a track from its current group into a target group.
  // Equivalent to copy + remove in a single state update.
  const transferTrack = (sourceGroupName: string, trackId: string, targetGroupName: string) => {
    setGroups(prev => {
      const sourceGroup = prev.find(g => g.name === sourceGroupName);
      const track = sourceGroup?.tracks.find(t => t.id === trackId);
      if (!track) return prev;

      return prev.map(g => {
        if (g.name === sourceGroupName) {
          return { ...g, tracks: g.tracks.filter(t => t.id !== trackId) };
        }
        if (g.name === targetGroupName) {
          if (g.tracks.some(t => t.id === track.id)) return g;
          return { ...g, tracks: [...g.tracks, track] };
        }
        return g;
      });
    });
  };

  // Merges the partnerGroup into targetGroup:
  //   - All tracks from partnerGroup are appended to targetGroup (deduped)
  //   - partnerGroup is removed from the list entirely
  //   - The partner's checkbox and expand state are also cleaned up
  const mergeGroups = (targetGroupName: string, partnerGroupName: string) => {
    setGroups(prev => {
      const partner = prev.find(g => g.name === partnerGroupName);
      if (!partner) return prev;

      return prev
        .map(g => {
          if (g.name !== targetGroupName) return g;
          const existingIds = new Set(g.tracks.map(t => t.id));
          const newTracks = partner.tracks.filter(t => !existingIds.has(t.id));
          return { ...g, tracks: [...g.tracks, ...newTracks] };
        })
        .filter(g => g.name !== partnerGroupName);
    });

    // Clean up the partner's UI state
    setEnabledGroups(prev => {
      const next = new Set(prev);
      next.delete(partnerGroupName);
      return next;
    });
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.delete(partnerGroupName);
      return next;
    });
    setGroupMeta(prev => {
      const targetM = prev[targetGroupName];
      const partnerM = prev[partnerGroupName];
      if (!targetM || !partnerM) return prev;

      // Merge the labels lists — used for description and future merges
      const mergedLabels = [...targetM.labels, ...partnerM.labels];

      // Build the new display name using the changed/unchanged formula
      const newDisplayName = buildMergedDisplayName(targetM, partnerM, playlistName);

      // Description always accumulates all original labels, ignoring any renames.
      // Format: "My Playlist — Rock + Blues + Jazz - Created by TuneCraft Split"
      const newDescription = `${playlistName} — ${mergedLabels.join(' + ')}`;

      const next = { ...prev };
      next[targetGroupName] = {
        labels: mergedLabels,
        displayName: newDisplayName,
        // The merged group is considered "changed" only if BOTH sides were user-renamed,
        // so that further merges with pristine groups still use the clean prefix formula.
        changed: targetM.changed && partnerM.changed,
        description: newDescription,
      };
      delete next[partnerGroupName];
      return next;
    });

    setMergeTarget(null);
  };

  // How many checked groups will actually be saved.
  // Unassigned is excluded from the count — it's an overflow bucket, not a real playlist destination.
  const realGroups = validGroups.filter(g => g.name !== UNASSIGNED);
  const checkedCount = realGroups.filter(g => enabledGroups.has(g.name)).length;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} labelId="split-modal-title" panelClassName="p-6 w-full max-w-5xl h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div className="min-w-0 mr-4">
            <h2 id="split-modal-title" className="text-lg font-bold text-text-primary">✂️ Split Playlist</h2>
            <p className="text-text-muted text-sm mt-1 truncate">
              Divide <span className="text-text-primary font-medium">{playlistName}</span> into smaller playlists
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            ✕
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex flex-col sm:flex-row gap-6 flex-1 min-h-0">

          {/* Left column — strategy picker (~24%) */}
          <StrategyPicker
            selected={strategy}
            audioFeatureCoverage={audioFeatureCoverage}
            onSelect={setStrategy}
          />

          {/* Right column — preview + actions (~70%) */}
          {/* w-0 flex-1 overflow-hidden: starts at zero width so flex-grow has a baseline,
              and overflow-hidden hard-clips content so child elements can never push
              the column wider than its flex allocation. */}
          <div className="w-full sm:w-0 flex-1 overflow-hidden flex flex-col min-h-0">

            {/* Preview header row with select-all toggle */}
            <div className="flex items-center justify-between mb-2 shrink-0">
              <p className="text-text-muted text-xs uppercase tracking-widest font-semibold">
                Preview — {checkedCount} of {realGroups.length} playlists selected
              </p>
              {/* Select all / deselect all shortcut */}
              <button
                type="button"
                onClick={() => {
                  if (checkedCount === realGroups.length) {
                    // All real groups checked → uncheck all (leave Unassigned as-is)
                    setEnabledGroups(new Set());
                  } else {
                    // Some or none checked → check all real groups
                    setEnabledGroups(new Set(realGroups.map(g => g.name)));
                  }
                }}
                className="text-xs text-accent hover:underline"
              >
                {checkedCount === realGroups.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

        {/* Group list — scrollable */}
        <div className="overflow-y-auto flex-1 rounded-xl border border-border-color bg-bg-secondary custom-scrollbar">
          {validGroups.length === 0 ? (
            <p className="text-text-muted text-sm p-4 text-center">
              No groups found for this strategy
            </p>
          ) : (
            validGroups.map((group, index) => (
              <GroupRow
                key={group.name}
                group={group}
                isLast={index === validGroups.length - 1}
                isExpanded={expandedGroups.has(group.name)}
                isEnabled={enabledGroups.has(group.name)}
                isMergeMode={mergeTarget !== null}
                isTheMergeTarget={mergeTarget === group.name}
                mergeTarget={mergeTarget}
                editingGroupId={editingGroupId}
                groupMeta={groupMeta}
                openPopover={openPopover}
                playlistName={playlistName}
                otherGroups={validGroups.filter(g => g.name !== group.name && g.name !== UNASSIGNED)}
                onToggleEnabled={() => setEnabledGroups(prev => toggleSetItem(prev, group.name))}
                onStartEdit={() => setEditingGroupId(group.name)}
                onNameChange={value => setGroupMeta(prev => ({ ...prev, [group.name]: { ...prev[group.name], displayName: value } }))}
                onNameBlur={() => {
                  setGroupMeta(prev => {
                    const current = prev[group.name];
                    const defaultName = `${playlistName} — ${group.name}`;
                    return { ...prev, [group.name]: { ...current, changed: current?.displayName !== defaultName } };
                  });
                  setEditingGroupId(null);
                }}
                onToggleExpand={() => setExpandedGroups(prev => toggleSetItem(prev, group.name))}
                onStartMerge={() => setMergeTarget(group.name)}
                onAbsorb={() => mergeGroups(mergeTarget!, group.name)}
                onCancelMerge={() => setMergeTarget(null)}
                onRemoveTrack={trackId => removeTrack(group.name, trackId)}
                onCopyTrack={(trackId, target) => copyTrack(group.name, trackId, target)}
                onTransferTrack={(trackId, target) => transferTrack(group.name, trackId, target)}
                onPopoverChange={setOpenPopover}
              />
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
                onClick={() => onConfirm(buildConfirmPayload(validGroups, enabledGroups, groupMeta, playlistName))}
                disabled={isLoading || checkedCount === 0}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-primary font-semibold py-3 rounded-full transition-all duration-200"
              >
                {isLoading ? splitLabel : `Create ${checkedCount} Playlist${checkedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div> {/* end right column */}
        </div> {/* end two-column body */}
    </ModalShell>
  );
}