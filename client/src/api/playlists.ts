import { API_BASE_URL } from './config';

// Represents the shape of a playlist returned by the Tunecraft API
export interface Playlist {
  spotifyId: string;
  name: string;
  trackCount: number;
  imageUrl: string | null;
  ownerId: string;        // platform user ID of the playlist owner
  platform?: string;      // which streaming service this playlist belongs to (e.g. 'SPOTIFY')
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

// Shuffles a playlist on Spotify using the chosen algorithms
export const shufflePlaylist = async (
  userId: string,
  spotifyId: string,
  tracks: { id: string; artist: string; genres: string[]; releaseYear: number | null }[],
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }
): Promise<{ success: boolean }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/${spotifyId}/shuffle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks, algorithms }),
    }
  );
  if (!response.ok) throw new Error('Failed to shuffle playlist');
  return response.json();
};

// Creates a shuffled copy of any playlist in the user's Spotify library
export const copyPlaylist = async (
  userId: string,
  tracks: { id: string }[],
  name: string
): Promise<{ success: boolean; playlist: { spotifyId: string; name: string; ownerId: string } }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/copy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
): Promise<{ success: boolean; playlist: { spotifyId: string; name: string; ownerId: string } }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks, name }),
    }
  );
  if (!response.ok) throw new Error('Failed to merge playlists');
  return response.json();
};

// Sends pre-grouped tracks to the backend to create one new Spotify playlist per group
export const splitPlaylist = async (
  userId: string,
  groups: { name: string; tracks: { id: string }[]; description: string }[]
): Promise<{ success: boolean; playlists: { spotifyId: string; name: string; ownerId: string }[] }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/split`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    }
  );
  if (!response.ok) throw new Error('Failed to split playlist');
  return response.json();
};

// Saves the current track order to an owned Spotify playlist
export const savePlaylist = async (
  userId: string,
  spotifyId: string,
  tracks: { id: string }[]
): Promise<{ success: boolean }> => {
  const response = await fetch(
    `${API_BASE_URL}/playlists/${userId}/${spotifyId}/save`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks }),
    }
  );
  if (!response.ok) throw new Error('Failed to save playlist');
  return response.json();
};