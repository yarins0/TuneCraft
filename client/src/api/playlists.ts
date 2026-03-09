import { API_BASE_URL } from './config';

// Represents the shape of a playlist returned by the Tunecraft API
export interface Playlist {
  spotifyId: string;
  name: string;
  trackCount: number;
  imageUrl: string | null;
  ownerId: string;  // Spotify ID of the playlist owner
}

// Fetches all playlists for a given user from the Tunecraft backend
export const fetchPlaylists = async (userId: string): Promise<Playlist[]> => {
  const response = await fetch(`${API_BASE_URL}/playlists/${userId}`);

  if (!response.ok) {
    throw new Error('Failed to fetch playlists');
  }

  const data = await response.json();
  return data.playlists;
};

// Represents the Liked Songs playlist card on the dashboard
export interface LikedSongsPlaylist {
  spotifyId: string;
  name: string;
  trackCount: number;
  imageUrl: null;
  isLiked: boolean;
}

// Fetches the user's Liked Songs count for the dashboard card
export const fetchLikedSongs = async (userId: string): Promise<LikedSongsPlaylist> => {
  const response = await fetch(`${API_BASE_URL}/playlists/${userId}/liked`);

  if (!response.ok) {
    throw new Error('Failed to fetch liked songs');
  }

  const data = await response.json();
  return data.playlist;
};

// Fetches metadata for any public playlist by Spotify ID
// Used by the discovery search bar on the dashboard
export const discoverPlaylist = async (
  userId: string,
  playlistId: string
): Promise<{
  spotifyId: string;
  name: string;
  ownerId: string;
  trackCount: number;
  imageUrl: string | null;
}> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/discover/${playlistId}`
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch playlist');
  }

  return response.json();
};