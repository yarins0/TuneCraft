import type { Track } from '../api/tracks';
import type { ReshuffleSchedule } from '../api/reshuffle';
import type { getPlatformConfig } from '../utils/platform';
import { getPlatformPlaylistUrl, getPlatformLabel, getPlatformBadgeStyle } from '../utils/platform';
import AppLogo from './AppLogo';
import { Badge } from './ui';

interface Props {
  name: string | undefined;
  tracks: Track[];
  playlistId: string;
  isLoadingMore: boolean;
  total: number;
  platformConfig: ReturnType<typeof getPlatformConfig>;
  dashboardTrackCount: number | null;
  reshuffleSchedule: ReshuffleSchedule | null;
  isSaveLoading: boolean;
  saveLabel: string;
  copyLabel: string;
  isOwner: boolean;
  onShuffleOpen: () => void;
  onSplitOpen: () => void;
  onSave: () => void;
  onCopyOpen: () => void;
}

export default function PlaylistHeader({
  name,
  tracks,
  playlistId,
  isLoadingMore,
  total,
  platformConfig,
  dashboardTrackCount,
  reshuffleSchedule,
  isSaveLoading,
  saveLabel,
  copyLabel,
  isOwner,
  onShuffleOpen,
  onSplitOpen,
  onSave,
  onCopyOpen,
}: Props) {
  return (
    <div className="sticky top-0 z-10 border-b border-border-color px-4 sm:px-8 py-3 sm:py-6 bg-bg-secondary">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">

          <AppLogo variant="compact" />

          <div className="hidden sm:block h-8 w-px bg-border-color shrink-0" />

          {/* Playlist name + live track count */}
          <div className="min-w-0">
            {name && (
              // Real <a> tag so the browser recognises this as a link —
              // enables middle-click, Ctrl+click, and right-click "Open in new tab".
              // href is undefined until tracks load (no platform yet), which safely
              // disables the link without hiding the title text.
              <a
                href={tracks[0]?.platform ? getPlatformPlaylistUrl(tracks[0].platform, playlistId) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                title={getPlatformLabel(tracks[0]?.platform)}
                className="text-lg font-semibold text-left text-text-primary hover:text-accent hover:underline cursor-pointer truncate max-w-xs block"
              >
                {name}
              </a>
            )}
            <p className="text-text-muted text-sm flex items-center gap-2">
              {isLoadingMore
                ? (() => {
                    // When totalTracksReliable is false (e.g. Tidal), the API often omits meta.total,
                    // so `total` equals the accumulated page count rather than the real track count.
                    // Fall back to the count the dashboard already knew from the playlist list API.
                    const displayTotal =
                      total > tracks.length
                        ? total
                        : !platformConfig.totalTracksReliable && dashboardTrackCount
                          ? dashboardTrackCount
                          : null;
                    return displayTotal
                      ? `Loading... ${tracks.length} of ${displayTotal} tracks`
                      : `Loading... ${tracks.length} tracks`;
                  })()
                : `${tracks.length} tracks`
              }
              {/* Platform badge — shown for every platform, coloured with the platform's brand colour */}
              {tracks.length > 0 && tracks[0]?.platform && (
                <Badge variant="platform" style={getPlatformBadgeStyle(tracks[0].platform)}>
                  {tracks[0].platform}
                </Badge>
              )}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <button
            onClick={onShuffleOpen}
            disabled={isLoadingMore}
            className={`bg-accent hover:bg-bg-secondary
            disabled:opacity-50 text-text-primary font-semibold px-3 sm:px-5 rounded-full text-sm
            transition-all duration-200 hover:scale-105 active:scale-95
            flex flex-col items-center ${reshuffleSchedule ? 'py-0.5' : 'py-1.5 sm:py-2'}`}
          >
            <span>🔀 Shuffle</span>
            {reshuffleSchedule && (
              <span className="text-xs font-normal opacity-80 leading-tight">Active</span>
            )}
          </button>
          <button
            onClick={onSplitOpen}
            disabled={isLoadingMore}
            className="bg-accent hover:bg-bg-secondary
            disabled:opacity-50 text-text-primary font-semibold px-3 py-1.5 sm:px-5 sm:py-2 rounded-full text-sm
            border border-border-color transition-all duration-200 hover:border-accent/50"
          >
            ✂️ Split
          </button>
          {isOwner && playlistId !== 'liked' && (
            <button
              onClick={onSave}
              disabled={isSaveLoading || isLoadingMore}
              className="bg-bg-card hover:bg-bg-secondary
              disabled:opacity-50 text-text-primary font-semibold px-3 py-1.5 sm:px-5 sm:py-2 rounded-full text-sm
              border border-border-color transition-all duration-200 hover:border-accent/50"
            >
              <span className="inline-block sm:w-[90px] text-center">
                {isSaveLoading ? saveLabel : '💾 Save'}
              </span>
            </button>
          )}
          <button
            onClick={onCopyOpen}
            disabled={isSaveLoading || isLoadingMore}
            className="bg-bg-card hover:bg-bg-secondary
                      disabled:opacity-50 text-text-primary font-semibold px-3 py-1.5 sm:px-5 sm:py-2 rounded-full text-sm
                      border border-border-color transition-all duration-200 hover:border-accent/50"
          >
            <span className="inline-block sm:w-[150px] text-center">
              {isSaveLoading ? copyLabel : '💾 Save as copy'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
