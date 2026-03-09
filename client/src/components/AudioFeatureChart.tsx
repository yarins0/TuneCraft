import { PieChart, Pie, Cell } from 'recharts';
import { AUDIO_FEATURES } from '../constants/audioFeatures';

interface AudioFeatureChartProps {
  label: string;
  value: number | null;
  isTempo?: boolean;
  isLoading?: boolean;
}

// Looks up the color for a given feature label from the centralized config
const getColor = (label: string): string =>
  AUDIO_FEATURES.find(f => f.label === label)?.color || '#a855f7';

export default function AudioFeatureChart({
  label,
  value,
  isTempo = false,
  isLoading = false,
}: AudioFeatureChartProps) {
  const color = getColor(label);
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
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24 flex items-center justify-center">
        {isLoading ? (
          <div className="w-24 h-24 rounded-full border-4 border-border-color border-t-accent animate-spin" />
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
    <div className="flex flex-col items-center gap-2">
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