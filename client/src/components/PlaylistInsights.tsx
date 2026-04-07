import type { Track, PlaylistAverages } from '../api/tracks';
import type { getPlatformConfig } from '../utils/platform';
import AudioFeatureChart from './AudioFeatureChart';
import PlaylistCompositionCharts from './PlaylistCompositionCharts';
import { AUDIO_FEATURES, MIN_AUDIO_FEATURE_COVERAGE } from '../constants/audioFeatures';
import ChevronDown from './ui';

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  isLoadingMore: boolean;
  averages: PlaylistAverages | null;
  audioFeatureCoverage: number;
  platformConfig: ReturnType<typeof getPlatformConfig>;
  tracks: Track[];
}

export default function PlaylistInsights({
  isOpen,
  onToggle,
  isLoadingMore,
  averages,
  audioFeatureCoverage,
  platformConfig,
  tracks,
}: Props) {
  return (
    <div className="mb-8 bg-bg-card rounded-2xl border border-border-color overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-secondary transition-colors duration-200"
      >
        <span className="text-sm font-semibold uppercase tracking-widest text-text-muted">
          Playlist Insights
          {isLoadingMore && (
            <span className="ml-2 text-accent/60 normal-case font-normal">
              — updating as tracks load
            </span>
          )}
        </span>
        <ChevronDown isOpen={isOpen} className="text-text-muted" />
      </button>

      {isOpen && averages && (
        <div className="px-6 pb-6">
          {/* Audio feature charts — hidden when coverage is below the minimum threshold */}
          {audioFeatureCoverage >= MIN_AUDIO_FEATURE_COVERAGE ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-6 justify-items-center mb-8">
              {AUDIO_FEATURES.map(feature => (
                <AudioFeatureChart
                  key={feature.key}
                  label={feature.label}
                  value={averages[feature.key as keyof PlaylistAverages]}
                  isTempo={feature.isTempo}
                  isLoading={isLoadingMore}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-text-muted text-sm mb-8 px-1 py-3 bg-bg-secondary rounded-xl border border-border-color">
              <span className="text-2xl shrink-0 pl-1">🎙️</span>
              <span>
                {platformConfig.audioFeaturesMissingHint
                  ? `Audio feature data isn't available for most tracks here — ${platformConfig.audioFeaturesMissingHint}`
                  : "Audio feature data isn't available for most tracks here."}
              </span>
            </div>
          )}
          {/* Genre and decade charts — always shown; sourced from Last.fm */}
          <PlaylistCompositionCharts tracks={tracks} isLoading={isLoadingMore} />
        </div>
      )}
    </div>
  );
}
