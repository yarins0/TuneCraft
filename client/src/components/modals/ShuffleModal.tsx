import { useState, useEffect } from 'react';
import ModalShell from './ModalShell';
import type { ReshuffleSchedule } from '../../api/reshuffle';
import { useAnimatedLabel } from '../../hooks/useAnimatedLabel';

interface ShuffleAlgorithms {
  trueRandom: boolean;
  artistSpread: boolean;
  genreSpread: boolean;
  chronological: boolean;
}

interface Props {
  isOpen: boolean;
  isOwner: boolean;
  playlistName: string;
  onClose: () => void;
  onShuffle: (algorithms: ShuffleAlgorithms) => void;
  isLoading: boolean;

  canScheduleReshuffle?: boolean;
  reshuffleSchedule?: ReshuffleSchedule | null;
  reshuffleInterval?: number;
  setReshuffleInterval?: (days: number) => void;
  initialAlgorithms?: ShuffleAlgorithms;
  onSaveReshuffle?: (intervalDays: number, algorithms: ShuffleAlgorithms) => void | Promise<void>;
  onDisableReshuffle?: () => void | Promise<void>;
  reshuffleLoading?: boolean;
}

const SHUFFLE_OPTIONS = [
  {
    key: 'artistSpread' as keyof ShuffleAlgorithms,
    label: 'Artist Spread',
    description: 'No two songs by the same artist play back to back',
    emoji: '🎤',
  },
  {
    key: 'genreSpread' as keyof ShuffleAlgorithms,
    label: 'Genre Spread',
    description: 'Similar genres grouped together for a smoother flow',
    emoji: '🎨',
  },
  {
    key: 'chronological' as keyof ShuffleAlgorithms,
    label: 'Chronological Mix',
    description: 'Alternates between old and new songs',
    emoji: '📅',
  },
  {
    key: 'trueRandom' as keyof ShuffleAlgorithms,
    label: 'True Random',
    description: 'Every song has an equal chance of being next',
    emoji: '🎲',
  },
];

export default function ShuffleModal({
  isOpen,
  isOwner,
  playlistName,
  onClose,
  onShuffle,
  isLoading,
  canScheduleReshuffle = false,
  reshuffleSchedule = null,
  reshuffleInterval = 7,
  setReshuffleInterval,
  initialAlgorithms,
  onSaveReshuffle,
  onDisableReshuffle,
  reshuffleLoading = false,
}: Props) {
  const [algorithms, setAlgorithms] = useState<ShuffleAlgorithms>(
    initialAlgorithms ?? {
      trueRandom: false,
      artistSpread: true,
      genreSpread: false,
      chronological: false,
    }
  );
  const [autoEnabled, setAutoEnabled] = useState<boolean>(Boolean(reshuffleSchedule));

  // If reshuffleSchedule arrives after the component mounts (async fetch in PlaylistDetail),
  // make sure autoEnabled stays in sync so the schedule button is enabled and shows the
  // correct "Update Schedule" label rather than staying stuck on "Activate Schedule".
  useEffect(() => {
    // Keep autoEnabled in sync in both directions — on when schedule exists, off when it's cleared
    setAutoEnabled(Boolean(reshuffleSchedule));
  }, [reshuffleSchedule]);

  // Animates the Shuffle button label while a shuffle is in flight
  const shuffleLabel = useAnimatedLabel(isLoading, 'Shuffling');

  // Animates the schedule save button label while the DB write is in flight
  const scheduleLabelBase = reshuffleSchedule ? 'Update Schedule' : 'Activate Schedule';
  const scheduleLabel = useAnimatedLabel(reshuffleLoading, scheduleLabelBase);

  if (!isOpen) return null;

  // Toggles a shuffle option
  // True Random is mutually exclusive with all other options
  const toggleOption = (key: keyof ShuffleAlgorithms) => {
    if (key === 'trueRandom') {
      // If true random is already on, turn it off
      if (algorithms.trueRandom) {
        setAlgorithms(prev => ({ ...prev, trueRandom: false }));
        return;
      }
      // Otherwise enable it and disable everything else
      setAlgorithms({
        trueRandom: true,
        artistSpread: false,
        genreSpread: false,
        chronological: false,
      });
      return;
    }
  
    // Selecting any real algorithm disables true random
    setAlgorithms(prev => ({
      ...prev,
      trueRandom: false,
      [key]: !prev[key],
    }));
  };

  const noneSelected = !Object.values(algorithms).some(Boolean);
  const showReshuffle = Boolean(isOwner && canScheduleReshuffle);

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} labelId="shuffle-modal-title" panelClassName="p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="min-w-0">
            <h2 id="shuffle-modal-title" className="text-lg font-bold text-text-primary truncate">{playlistName}</h2>
            <p className="text-text-muted text-sm">Your shuffler controller</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: existing shuffle modal content */}
          <div className="min-w-0 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <span className="flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-text-muted">
                🔀 Shuffle
              </span>
            </div>

            {/* Shuffle options */}
            <div className="flex flex-col gap-3 mb-6 flex-1">
              {SHUFFLE_OPTIONS.map(option => {
                const isChecked = algorithms[option.key];
                const isDisabled = option.key !== 'trueRandom' && algorithms.trueRandom;

                return (
                  <button
                    key={option.key}
                    onClick={() => toggleOption(option.key)}
                    className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-200 text-left ${
                      isChecked
                        ? 'border-accent bg-accent/10'
                        : 'border-border-color hover:border-accent/40'
                    } ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    disabled={isDisabled}
                  >
                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 border-2 transition-colors ${
                      isChecked ? 'bg-accent border-accent' : 'border-border-color'
                    }`}>
                      {isChecked && <span className="text-text-primary text-xs">✓</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary">
                        {option.emoji} {option.label}
                      </p>
                      <p className="text-text-muted text-xs mt-0.5">{option.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-auto">
              <button
                onClick={onClose}
                className="flex-1 bg-bg-secondary hover:bg-bg-primary text-text-muted font-semibold py-3 rounded-full border border-border-color transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => onShuffle(algorithms)}
                disabled={noneSelected || isLoading}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-primary font-semibold py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
              >
                {reshuffleLoading ? shuffleLabel : 'Shuffle'}
              </button>
            </div>
          </div>

          {/* Right: auto-reshuffle scheduler */}
          <div className="min-w-0 border-t border-border-color pt-4 md:border-t-0 md:pt-0 md:border-l md:pl-6 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <span className="flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-text-muted">
                ⏰ Auto-Reshuffle
                {reshuffleSchedule && (
                  <span className="normal-case tracking-normal font-medium text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </span>
              {showReshuffle && (
                <div className="flex items-center gap-3">
                  {/* Toggle — when a schedule is active it stays ON; toggling it off calls onDisableReshuffle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (reshuffleSchedule) {
                        // Schedule is active — turning the toggle off disables it
                        onDisableReshuffle?.();
                      } else {
                        setAutoEnabled(v => !v);
                      }
                    }}
                    disabled={reshuffleLoading}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all duration-200 disabled:opacity-50 ${
                      autoEnabled ? 'border-accent bg-accent/10 text-accent' : 'border-border-color text-text-muted hover:border-accent/40'
                    }`}
                  >
                    <span>Enable</span>
                    <span
                      className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${
                        autoEnabled ? 'bg-accent' : 'bg-bg-secondary'
                      }`}
                      aria-hidden="true"
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                          autoEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </span>
                  </button>
                </div>
              )}
            </div>

            {!showReshuffle ? (
              <div className="text-text-muted text-sm flex flex-col gap-2">
                <p>Auto-reshuffle is only available for playlists you own.</p>
                <p>Tip: For Liked Songs, try creating a copy of the playlist first!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 flex-1">
                {/* Interval picker */}
                <div className={autoEnabled ? '' : 'opacity-50 pointer-events-none'}>
                  <p className="text-text-muted text-xs uppercase tracking-widest mb-3">
                    Reshuffle every
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {[1, 3, 7, 14, 30].map(days => (
                      <button
                        key={days}
                        onClick={() => setReshuffleInterval?.(days)}
                        disabled={!setReshuffleInterval}
                        className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-200 ${
                          reshuffleInterval === days
                            ? 'bg-accent border-accent text-text-primary'
                            : 'bg-bg-secondary border-border-color text-text-muted hover:border-accent/40'
                        } ${!setReshuffleInterval ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {days === 1 ? 'Daily' : days === 7 ? 'Weekly' : days === 14 ? 'Bi-weekly' : days === 30 ? 'Monthly' : `${days} days`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Middle: Active schedule row (pill centered horizontally when present) */}
                <div className={reshuffleSchedule ? 'flex-1 flex items-center' : 'flex-1'}>
                  {reshuffleSchedule ? (
                    <div className="w-full flex justify-center">
                      <div className="inline-flex max-w-full bg-accent/10 border border-accent/30 rounded-full px-4 py-3 items-center justify-between gap-3">
                        <div className="min-w-0">
                        <p className="text-accent text-sm font-semibold truncate">Schedule active</p>
                        <p className="text-text-muted text-xs truncate">
                          Next:{' '}
                          {reshuffleSchedule.nextReshuffleAt
                            ? new Date(reshuffleSchedule.nextReshuffleAt).toLocaleDateString(undefined, {
                                weekday: 'short', month: 'short', day: 'numeric',
                              })
                            : '—'}
                          {reshuffleSchedule.lastReshuffledAt && (
                            <>
                              {' '}· Last:{' '}
                              {new Date(reshuffleSchedule.lastReshuffledAt).toLocaleDateString(undefined, {
                                weekday: 'short', month: 'short', day: 'numeric',
                              })}
                            </>
                          )}
                        </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-text-muted text-sm">
                      Enable auto-reshuffle to reshuffle this playlist on a schedule and save it automatically.
                      The schedule will use the shuffle style you selected on the left.
                    </p>
                  )}
                </div>

                {/* Bottom: Save button */}
                <button
                  onClick={() => void onSaveReshuffle?.(reshuffleInterval, algorithms)}
                  disabled={reshuffleLoading || noneSelected || !onSaveReshuffle || !autoEnabled}
                  className="self-center mt-auto bg-accent
                            hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed
                            text-text-primary font-semibold px-6 py-2.5 rounded-full transition-all duration-200
                            hover:scale-105 active:scale-95 min-w-[200px] text-center"
                >
                  {scheduleLabel}
                </button>
              </div>
            )}
          </div>
        </div>
    </ModalShell>
  );
}