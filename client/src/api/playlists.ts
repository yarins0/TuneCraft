import { API_BASE_URL } from './config';
import { getAuthHeaders } from '../utils/accounts';

// Represents the shape of a playlist returned by the Tunecraft API
export interface Playlist {
  platformId: string;     // the playlist's ID on its native platform (e.g. Spotify playlist ID)
  name: string;
  trackCount: number;
  imageUrl: string | null;
  ownerId: string;        // platform user ID of the playlist owner
  platform?: string;      // which streaming service this playlist belongs to (e.g. 'SPOTIFY')
}

// Fetches all playlists for a given user from the Tunecraft backend
export const fetchPlaylists = async (userId: string): Promise<Playlist[]> => {
  const response = await fetch(`${API_BASE_URL}/playlists/${userId}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch playlists');
  }

  const data = await response.json();
  return data.playlists;
};

// Represents the Liked Songs playlist card on the dashboard
export interface LikedSongsPlaylist {
  platformId: string;
  name: string;
  trackCount: number;
  imageUrl: null;
  isLiked: boolean;
}

// Fetches the user's Liked Songs count for the dashboard card
export const fetchLikedSongs = async (userId: string): Promise<LikedSongsPlaylist> => {
  const response = await fetch(`${API_BASE_URL}/playlists/${userId}/liked`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch liked songs');
  }

  const data = await response.json();
  return data.playlist;
};

// Fetches metadata for any public playlist by its platform ID
// Used by the discovery search bar on the dashboard
export const discoverPlaylist = async (
  userId: string,
  playlistId: string
): Promise<{
  platformId: string;
  name: string;
  ownerId: string;
  trackCount: number;
  imageUrl: string | null;
}> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/discover/${playlistId}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch playlist');
  }

  return response.json();
};

// Resolves a full platform URL (e.g. https://soundcloud.com/user/sets/name) to a playlist.
// Used when extractPlaylistId returns a URL rather than a bare numeric/alphanumeric ID.
// The server handles the slug → numeric ID resolution via the platform's resolve API.
export const discoverPlaylistByUrl = async (
  userId: string,
  url: string
): Promise<{
  platformId: string;
  name: string;
  ownerId: string;
  trackCount: number;
  imageUrl: string | null;
}> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/discover?url=${encodeURIComponent(url)}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch playlist');
  }

  return response.json();
};

// Shuffles a playlist on the platform using the chosen algorithms
export const shufflePlaylist = async (
  userId: string,
  playlistId: string,
  tracks: { id: string; artist: string; genres: string[]; releaseYear: number | null }[],
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }
): Promise<{ success: boolean }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/${playlistId}/shuffle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ tracks, algorithms }),
    }
  );
  if (!response.ok) throw new Error('Failed to shuffle playlist');
  return response.json();
};

// Creates a named copy of any playlist in the user's library on the platform
export const copyPlaylist = async (
  userId: string,
  tracks: { id: string }[],
  name: string
): Promise<{ success: boolean; playlist: { platformId: string; name: string; ownerId: string } }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/copy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ tracks, name }),
    }
  );
  if (!response.ok) throw new Error('Failed to copy playlist');
  return response.json();
};

// Creates a new playlist by merging tracks from multiple playlists
// The frontend handles fetching + deduplication; this just sends the final track list to the backend
export const mergePlaylist = async (
  userId: string,
  tracks: { id: string }[],
  name: string
): Promise<{ success: boolean; playlist: { platformId: string; name: string; ownerId: string } }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ tracks, name }),
    }
  );
  if (!response.ok) throw new Error('Failed to merge playlists');
  return response.json();
};

// Sends pre-grouped tracks to the backend to create one new playlist per group
export const splitPlaylist = async (
  userId: string,
  groups: { name: string; tracks: { id: string }[]; description: string }[]
): Promise<{ success: boolean; playlists: { platformId: string; name: string; ownerId: string }[] }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/split`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ groups }),
    }
  );
  if (!response.ok) throw new Error('Failed to split playlist');
  return response.json();
};

// Saves the current track order to an owned playlist
export const savePlaylist = async (
  userId: string,
  playlistId: string,
  tracks: { id: string }[]
): Promise<{ success: boolean }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/${playlistId}/save`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ tracks }),
    }
  );
  if (!response.ok) throw new Error('Failed to save playlist');
  return response.json();
};
