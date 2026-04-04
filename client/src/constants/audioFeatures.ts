// JS-accessible mirrors of CSS design tokens.
// These values must stay in sync with their counterparts in index.css.
// They are needed wherever CSS variables cannot be used directly — e.g. canvas
// rendering, Recharts Cell fill props, and inline style fallback values.
export const COLOR_ACCENT      = '#a855f7'; // --color-accent
export const COLOR_WARNING     = '#ef4444'; // --color-warning
// The empty/unfilled slice in audio feature pie charts.
export const CHART_TRACK_COLOR = 'rgba(255, 255, 255, 0.05)';

// Centralized configuration for all audio feature display properties
// Keeps labels, colors, and descriptions in one place for easy updates
export const AUDIO_FEATURES = [
    { key: 'energy',           label: 'Energy',           color: COLOR_ACCENT,   isTempo: false, description: 'Intensity and activity (calm → energetic).' },
    { key: 'danceability',     label: 'Danceability',     color: '#ec4899',      isTempo: false, description: 'How suitable it feels for dancing (groove, rhythm).' },
    { key: 'valence',          label: 'Valence',          color: '#f59e0b',      isTempo: false, description: 'Musical positivity (sad/dark → happy/bright).' },
    { key: 'acousticness',     label: 'Acousticness',     color: '#10b981',      isTempo: false, description: 'How acoustic the track sounds (electronic → acoustic).' },
    { key: 'instrumentalness', label: 'Instrumentalness', color: '#3b82f6',      isTempo: false, description: 'Likelihood of no vocals (vocals → instrumental).' },
    { key: 'speechiness',      label: 'Speechiness',      color: COLOR_WARNING,  isTempo: false, description: 'How speech-like it is (music → spoken word).' },
    { key: 'tempo',            label: 'Tempo',            color: '#6c254f',      isTempo: true,  description: 'Speed of the track in beats per minute (BPM).' },
  ];

  // Minimum fraction of tracks that must have audio features before feature-dependent
// UI is enabled (split strategies, Insights tab charts). Below this threshold the
// data is too sparse to produce meaningful results.
export const MIN_AUDIO_FEATURE_COVERAGE = 0.2;

// Colors used for pie chart slices in the playlist composition charts.
// The first entry mirrors --color-accent; the sixth mirrors --color-warning.
// The rest are fixed chart palette colours with no CSS token counterpart.
export const CHART_COLORS = [
  COLOR_ACCENT,   // purple  — mirrors --color-accent
  '#ec4899',      // pink
  '#f59e0b',      // amber
  '#10b981',      // emerald
  '#3b82f6',      // blue
  COLOR_WARNING,  // red     — mirrors --color-warning
  '#6c254f',      // violet
];