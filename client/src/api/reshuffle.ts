import { API_BASE_URL } from './config';

// The shape of an auto-reshuffle schedule stored in the database
export interface ReshuffleSchedule {
  id: string;
  spotifyPlaylistId: string;
  name: string;
  autoReshuffle: boolean;
  intervalDays: number | null;
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  } | null;
  lastReshuffledAt: string | null; // ISO date string from the DB
  nextReshuffleAt: string | null;  // ISO date string from the DB
}

// Enables or updates auto-reshuffle for a playlist
// Called when the user saves settings in the auto-reshuffle panel
export const enableReshuffle = async (
  userId: string,
  spotifyId: string,
  name: string,
  intervalDays: number,
  algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }
): Promise<{ schedule: ReshuffleSchedule }> => {
  const response = await fetch(
    `${API_BASE_URL}/reshuffle/${userId}/${spotifyId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistName: name, intervalDays, algorithms }),
    }
  );
  if (!response.ok) throw new Error('Failed to enable auto-reshuffle');
  return response.json();
};

// Disables auto-reshuffle for a playlist
// Deletes the schedule from the database entirely
export const disableReshuffle = async (
  userId: string,
  spotifyId: string
): Promise<{ success: boolean }> => {
  const response = await fetch(
    `${API_BASE_URL}/reshuffle/${userId}/${spotifyId}`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error('Failed to disable auto-reshuffle');
  return response.json();
};

// Fetches the current auto-reshuffle schedule for a specific playlist
// Returns null if no schedule exists for this playlist
export const fetchReshuffleSchedule = async (
  userId: string,
  spotifyId: string
): Promise<ReshuffleSchedule | null> => {
  const response = await fetch(`${API_BASE_URL}/reshuffle/${userId}`);
  if (!response.ok) throw new Error('Failed to fetch reshuffle schedules');

  const data: { schedules: ReshuffleSchedule[] } = await response.json();

  // The GET route returns ALL schedules for a user — filter to just this playlist
  return data.schedules.find(s => s.spotifyPlaylistId === spotifyId) ?? null;
};