import type { Track } from '../api/tracks';
import { AUDIO_FEATURES } from '../constants/audioFeatures';

type Props = {
  track: Track;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const normalizeFeatureValue = (value: number | null): number | null => {
  if (value === null || Number.isNaN(value)) return null;
  // Spotify audio features are already 0..1 for these keys.
  return clamp01(value);
};

function FeatureBar({
  label,
  color,
  normalized,
  title,
}: {
  label: string;
  color: string;
  normalized: number | null;
  title: string;
}) {
  const pct = normalized === null ? 0 : Math.round(normalized * 100);

  return (
    <div className="flex items-center gap-1 min-w-0 sm:flex-col sm:items-start sm:gap-1">
      <div className="text-[11px] text-text-muted shrink-0 w-[5.5rem] sm:w-full truncate">{label}</div>
      <div
        className="h-1.5 rounded-full bg-bg-secondary border border-border-color overflow-hidden flex-1 sm:flex-none sm:w-full"
        title={title}
        aria-label={title}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: normalized === null ? '0%' : `${pct}%`,
            backgroundColor: color,
            opacity: normalized === null ? 0 : 0.9,
          }}
        />
      </div>
    </div>
  );
}

export default function TrackAudioFeaturesCollapse({ track }: Props) {
  const hasAny = AUDIO_FEATURES.some(f => track.audioFeatures[f.key as keyof Track['audioFeatures']] !== null);

  return (
    <>
      {!hasAny ? (
        <div className="text-text-muted text-xs">No audio features available for this track.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-y-2 sm:gap-y-3 sm:gap-x-4">
          {AUDIO_FEATURES.map(f => {
            const raw = track.audioFeatures[f.key as keyof Track['audioFeatures']];
            if (f.key === 'tempo') {
              const tooltip = raw === null
                ? `${f.label}\n${f.description}\n\nNo tempo data for this track.`
                : `${f.label} · ${Math.round(raw)} BPM\n${f.description}`;
              return (
                <div key={f.key} className="flex items-center gap-1 min-w-0 sm:flex-col sm:items-start sm:gap-1" title={tooltip} aria-label={tooltip}>
                  <div className="text-[11px] text-text-muted shrink-0 w-[5.5rem] sm:w-full truncate">{f.label}</div>
                  <div className="text-[11px] text-text-primary truncate">
                    {raw === null ? '—' : `${Math.round(raw)} bpm`}
                  </div>
                </div>
              );
            }

            const normalized = normalizeFeatureValue(raw);
            const title = raw === null
              ? `${f.label}\n${f.description}\n\nNo data for this track.`
              : `${f.label}\n${f.description}`;

            return (
              <FeatureBar
                key={f.key}
                label={f.label}
                color={f.color}
                normalized={normalized}
                title={title}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
