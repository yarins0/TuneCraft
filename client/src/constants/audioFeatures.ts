// Centralized configuration for all audio feature display properties
// Keeps labels, colors, and descriptions in one place for easy updates
export const AUDIO_FEATURES = [
    { key: 'energy',           label: 'Energy',           color: '#a855f7', isTempo: false },
    { key: 'danceability',     label: 'Danceability',     color: '#ec4899', isTempo: false },
    { key: 'valence',          label: 'Valence',          color: '#f59e0b', isTempo: false },
    { key: 'acousticness',     label: 'Acousticness',     color: '#10b981', isTempo: false },
    { key: 'instrumentalness', label: 'Instrumentalness', color: '#3b82f6', isTempo: false },
    { key: 'speechiness',      label: 'Speechiness',      color: '#ef4444', isTempo: false },
    { key: 'tempo',            label: 'Tempo',            color: '#6c254f', isTempo: true  },
  ];

  // Colors used for pie chart slices in the playlist composition charts
export const CHART_COLORS = [
  '#a855f7', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#ef4444', // red
  '#6c254f', // violet
];