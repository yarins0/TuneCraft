// Centralized configuration for all audio feature display properties
// Keeps labels, colors, and descriptions in one place for easy updates
export const AUDIO_FEATURES = [
    { key: 'energy',           label: 'Energy',           color: '#a855f7', isTempo: false, description: 'Intensity and activity (calm → energetic).' },
    { key: 'danceability',     label: 'Danceability',     color: '#ec4899', isTempo: false, description: 'How suitable it feels for dancing (groove, rhythm).' },
    { key: 'valence',          label: 'Valence',          color: '#f59e0b', isTempo: false, description: 'Musical positivity (sad/dark → happy/bright).' },
    { key: 'acousticness',     label: 'Acousticness',     color: '#10b981', isTempo: false, description: 'How acoustic the track sounds (electronic → acoustic).' },
    { key: 'instrumentalness', label: 'Instrumentalness', color: '#3b82f6', isTempo: false, description: 'Likelihood of no vocals (vocals → instrumental).' },
    { key: 'speechiness',      label: 'Speechiness',      color: '#ef4444', isTempo: false, description: 'How speech-like it is (music → spoken word).' },
    { key: 'tempo',            label: 'Tempo',            color: '#6c254f', isTempo: true,  description: 'Speed of the track in beats per minute (BPM).' },
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