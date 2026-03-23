import { API_BASE_URL } from './config';

export interface AudioFeatures {
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  speechiness: number | null;
  tempo: number | null;
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  albumName: string;
  albumImageUrl: string | null;
  durationMs: number;
  releaseYear: number | null;
  genres: string[];
  audioFeatures: AudioFeatures;
  platform?: string; // which streaming service this track belongs to (e.g. 'SPOTIFY')
}

export interface PlaylistAverages {
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  speechiness: number | null;
  tempo: number | null;
}

// Response shape returned by the paginated tracks endpoint
export interface TracksPageResponse {
  tracks: Track[];
  playlistAverages: PlaylistAverages;
  total: number;
  hasMore: boolean;
  nextPage: number;
}

// Converts milliseconds to a human-readable duration string (e.g. 3:45)
export const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Fetches cached audio features for a list of track IDs.
// Only returns entries already in the server cache — no external API calls made.
// Used to poll for features that are being fetched in the background after a cache miss.
export const fetchPendingFeatures = async (
  userId: string,
  trackIds: string[]
): Promise<{ features: Record<string, AudioFeatures> }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/features?ids=${trackIds.join(',')}`
  );
  if (!response.ok) throw new Error('Failed to fetch pending features');
  return response.json();
};

// Fetches cached genre tags for a list of artist names.
// Only returns entries already in the server cache — no external API calls made.
// Used to poll for genres that are being fetched in the background after a cache miss.
// Names are matched case-insensitively; the response is keyed by lowercased+trimmed name.
export const fetchPendingGenres = async (
  userId: string,
  artistNames: string[]
): Promise<{ genres: Record<string, string[]> }> => {
  const encoded = artistNames.map(n => encodeURIComponent(n)).join(',');
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/genres?names=${encoded}`
  );
  if (!response.ok) throw new Error('Failed to fetch pending genres');
  return response.json();
};

// Fetches a single page of tracks for a playlist
// page=0 returns the first 50 tracks, page=1 returns the next 50, etc.
export const fetchTracksPage = async (
  userId: string,
  playlistId: string,
  page: number = 0
): Promise<TracksPageResponse> => {
  const base = playlistId === 'liked'
    ? `${API_BASE_URL}/playlists/${userId}/liked/tracks`
    : `${API_BASE_URL}/playlists/${userId}/${playlistId}/tracks`;

  const response = await fetch(`${base}?page=${page}`);

  if (!response.ok) {
    throw new Error('Failed to fetch tracks');
  }

  return response.json();
};