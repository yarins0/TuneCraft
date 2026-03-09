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

// Fetches a single page of tracks for a playlist
// page=0 returns the first 50 tracks, page=1 returns the next 50, etc.
export const fetchTracksPage = async (
  userId: string,
  spotifyPlaylistId: string,
  page: number = 0
): Promise<TracksPageResponse> => {
  const base = spotifyPlaylistId === 'liked'
    ? `${API_BASE_URL}/playlists/${userId}/liked/tracks`
    : `${API_BASE_URL}/playlists/${userId}/${spotifyPlaylistId}/tracks`;

  const response = await fetch(`${base}?page=${page}`);

  if (!response.ok) {
    throw new Error('Failed to fetch tracks');
  }

  return response.json();
};