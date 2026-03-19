import { useEffect, useState } from 'react';
import { enableReshuffle, disableReshuffle, fetchReshuffleSchedule } from '../api/reshuffle';
import type { ReshuffleSchedule } from '../api/reshuffle';

const getUserId = () => localStorage.getItem('userId') || '';

interface Options {
  playlistId: string | undefined;
  isOwner: boolean;
  name: string | undefined;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export interface UseReshuffleScheduleResult {
  reshuffleSchedule: ReshuffleSchedule | null;
  setReshuffleSchedule: React.Dispatch<React.SetStateAction<ReshuffleSchedule | null>>;
  reshuffleInterval: number;
  setReshuffleInterval: React.Dispatch<React.SetStateAction<number>>;
  reshuffleAlgorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  };
  reshuffleLoading: boolean;
  handleSaveReshuffle: (
    intervalDays: number,
    algorithms: { trueRandom: boolean; artistSpread: boolean; genreSpread: boolean; chronological: boolean }
  ) => Promise<void>;
  handleDisableReshuffle: () => Promise<void>;
}

// Manages the auto-reshuffle schedule for a single playlist.
// On mount, fetches the existing schedule (if any) and pre-fills the panel inputs.
// Exposes save and disable handlers that update the DB and mirror changes locally
// so the UI reflects the new schedule without a page reload.
export const useReshuffleSchedule = ({
  playlistId,
  isOwner,
  name,
  onSuccess,
  onError,
}: Options): UseReshuffleScheduleResult => {
  const [reshuffleSchedule, setReshuffleSchedule] = useState<ReshuffleSchedule | null>(null);
  const [reshuffleInterval, setReshuffleInterval] = useState(7);
  const [reshuffleAlgorithms, setReshuffleAlgorithms] = useState({
    trueRandom: false,
    artistSpread: true,
    genreSpread: false,
    chronological: false,
  });
  const [reshuffleLoading, setReshuffleLoading] = useState(false);

  // Fetch the saved schedule when the playlist loads.
  // Liked Songs and non-owner playlists never have a reshuffle schedule.
  useEffect(() => {
    if (!playlistId || playlistId === 'liked' || !isOwner) return;

    fetchReshuffleSchedule(getUserId(), playlistId)
      .then(schedule => {
        setReshuffleSchedule(schedule);
        // Pre-fill inputs from the saved schedule so the user sees their current settings
        if (schedule) {
          setReshuffleInterval(schedule.intervalDays ?? 7);
          if (schedule.algorithms) setReshuffleAlgorithms(schedule.algorithms);
        }
      })
      .catch(() => {}); // Silently ignore — the panel just shows defaults
  }, [playlistId, isOwner]);

  // Saves a new or updated reshuffle schedule to the database.
  // nextReshuffleAt starts from now so the cron window begins immediately.
  const handleSaveReshuffle = async (
    intervalDays: number,
    algorithms: { trueRandom: boolean; artistSpread: boolean; genreSpread: boolean; chronological: boolean }
  ) => {
    if (!playlistId) return;
    setReshuffleLoading(true);
    try {
      const { schedule } = await enableReshuffle(
        getUserId(), playlistId, name || '', intervalDays, algorithms
      );
      setReshuffleSchedule(schedule);
      setReshuffleInterval(intervalDays);
      setReshuffleAlgorithms(algorithms);
      onSuccess('Auto-reshuffle scheduled!');
    } catch {
      onError('Failed to save auto-reshuffle settings.');
    } finally {
      setReshuffleLoading(false);
    }
  };

  // Deletes the schedule from the database and resets local state to defaults.
  const handleDisableReshuffle = async () => {
    if (!playlistId) return;
    setReshuffleLoading(true);
    try {
      await disableReshuffle(getUserId(), playlistId);
      setReshuffleSchedule(null);
      setReshuffleInterval(7);
      setReshuffleAlgorithms({ trueRandom: false, artistSpread: true, genreSpread: false, chronological: false });
      onSuccess('Auto-reshuffle disabled.');
    } catch {
      onError('Failed to disable auto-reshuffle.');
    } finally {
      setReshuffleLoading(false);
    }
  };

  return {
    reshuffleSchedule,
    setReshuffleSchedule,
    reshuffleInterval,
    setReshuffleInterval,
    reshuffleAlgorithms,
    reshuffleLoading,
    handleSaveReshuffle,
    handleDisableReshuffle,
  };
};
