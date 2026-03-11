import { PieChart, Pie, Cell } from 'recharts';
import { AUDIO_FEATURES } from '../constants/audioFeatures';

interface AudioFeatureChartProps {
  label: string;
  value: number | null;
  isTempo?: boolean;
  isLoading?: boolean;
}

// Looks up display info for a given feature label from the centralized config
const getFeatureMeta = (label: string) =>
  AUDIO_FEATURES.find(f => f.label === label);

export default function AudioFeatureChart({
  label,
  value,
  isTempo = false,
  isLoading = false,
}: AudioFeatureChartProps) {
  const meta = getFeatureMeta(label);
  const color = meta?.color || '#a855f7';
  const baseDescription = meta?.description || '';
  const tooltip = (() => {
    if (value === null) {
      return baseDescription
        ? `${label}\n${baseDescription}\n\nNo data available yet.`
        : label;
    }
    if (isTempo) {
      return baseDescription
        ? `${label} · ${Math.round(value)} BPM\n${baseDescription}`
        : `${label} · ${Math.round(value)} BPM`;
    }
    const pct = Math.round((value ?? 0) * 100);
    return baseDescription
      ? `${label} · ${pct}%\n${baseDescription}`
      : `${label} · ${pct}%`;
  })();
  const displayValue = value ?? 0;
  const percentage = isTempo ? 1 : displayValue;

  const data = [
    { value: percentage },
    { value: 1 - percentage },
  ];

  const centerLabel = isTempo
    ? `${Math.round(displayValue)}`
    : `${Math.round(displayValue * 100)}`;

  const subLabel = isTempo ? 'BPM' : '%';

  // Shows a spinning ring while loading, or N/A if data is unavailable
  if (value === null) return (
    <div className="flex flex-col items-center gap-2" title={tooltip} aria-label={tooltip}>
      <div className="relative w-24 h-24 flex items-center justify-center">
        {isLoading ? (
          <div
            className="w-24 h-24 rounded-full border-4 border-border-color animate-spin"
            style={{ borderTopColor: color }}
          />
        ) : (
          <div className="w-24 h-24 rounded-full border-4 border-border-color flex items-center justify-center">
            <span className="text-text-muted text-xs">N/A</span>
          </div>
        )}
      </div>
      <p className="text-text-muted text-xs text-center">{label}</p>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-2" title={tooltip} aria-label={tooltip}>
      <div className="relative w-24 h-24">
        <PieChart width={96} height={96}>
          <Pie
            data={data}
            cx={43}
            cy={43}
            innerRadius={34}
            outerRadius={46}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            strokeWidth={0}
          >
            <Cell fill={color} />
            <Cell fill="rgba(255,255,255,0.05)" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold text-text-primary leading-none">
            {centerLabel}
          </span>
          <span className="text-text-muted" style={{ fontSize: '9px' }}>
            {subLabel}
          </span>
        </div>
      </div>
      <p className="text-text-muted text-xs text-center">{label}</p>
    </div>
  );
}