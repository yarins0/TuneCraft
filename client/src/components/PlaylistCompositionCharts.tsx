import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Track } from '../api/tracks';
import { CHART_COLORS } from '../constants/audioFeatures';

interface Props {
  tracks: Track[];
  isLoading: boolean;
}

interface LoadingRingProps {
  label: string;
  color: string;
}

interface TooltipPayloadItem {
  name: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

// Derives the decade label from a release year (e.g. 1985 → "80s")
const getDecade = (year: number): string => {
  const decade = Math.floor(year / 10) * 10;
  return `${decade.toString().slice(-2)}s`;
};

// Aggregates track data into a sorted pie chart data array
// Returns top N entries plus an "Others" slice for the remainder
const buildChartData = (
  items: string[],
  topN: number
): { name: string; value: number }[] => {
  const counts: Record<string, number> = {};
  items.forEach(item => {
    if (item) counts[item] = (counts[item] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const othersCount = sorted.slice(topN).reduce((sum, [, v]) => sum + v, 0);

  const result = top.map(([name, value]) => ({ name, value }));
  if (othersCount > 0) result.push({ name: 'Others', value: othersCount });
  return result;
};

// Spinning loading ring shown while tracks are still being fetched
const LoadingRing = ({ label, color }: LoadingRingProps) => (
  <div className="flex flex-col items-center justify-center gap-3 h-64">
    <div
      className="w-24 h-24 rounded-full border-4 border-border-color animate-spin"
      style={{ borderTopColor: color }}
    />
    <p className="text-text-muted text-sm">{label}</p>
  </div>
);

// Custom tooltip shown when hovering over a pie slice
const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-card border border-border-color rounded-xl px-3 py-2 text-sm">
        <p className="text-text-primary font-semibold">{payload[0].name}</p>
        <p className="text-text-muted">{payload[0].value} tracks</p>
      </div>
    );
  }
  return null;
};

export default function PlaylistCompositionCharts({ tracks, isLoading }: Props) {
  const allGenres = tracks.flatMap(t => t.genres).filter(Boolean);
  const genreData = buildChartData(allGenres, 6);

  const allDecades = tracks
    .map(t => t.releaseYear ? getDecade(t.releaseYear) : null)
    .filter(Boolean) as string[];
  const decadeData = buildChartData(allDecades, 10);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">

      {/* Genre Distribution Chart */}
      <div className="bg-bg-secondary rounded-2xl border border-border-color p-6">
        <h3 className="text-text-muted text-xs uppercase tracking-widest mb-4">
          Genre Distribution
        </h3>
        {isLoading && genreData.length === 0 ? (
          <LoadingRing label="Analyzing genres..." color={CHART_COLORS[0]} />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={genreData}
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {genreData.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span className="text-text-muted text-xs">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        {isLoading && genreData.length > 0 && (
          <p className="text-accent/60 text-xs text-center mt-2 animate-pulse">
            Updating as tracks load...
          </p>
        )}
      </div>

      {/* Decades Distribution Chart */}
      <div className="bg-bg-secondary rounded-2xl border border-border-color p-6">
        <h3 className="text-text-muted text-xs uppercase tracking-widest mb-4">
          Decades Distribution
        </h3>
        {isLoading && decadeData.length === 0 ? (
          <LoadingRing label="Analyzing decades..." color={CHART_COLORS[1]} />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={decadeData}
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {decadeData.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span className="text-text-muted text-xs">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        {isLoading && decadeData.length > 0 && (
          <p className="text-accent/60 text-xs text-center mt-2 animate-pulse">
            Updating as tracks load...
          </p>
        )}
      </div>
    </div>
  );
}