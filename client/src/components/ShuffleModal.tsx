import { useState } from 'react';

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
  playlistName,
  onClose,
  onShuffle,
  isLoading,
}: Props) {
  const [algorithms, setAlgorithms] = useState<ShuffleAlgorithms>({
    trueRandom: false,
    artistSpread: true,
    genreSpread: false,
    chronological: false,
  });

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

  return (
    // Backdrop — clicking outside closes the modal
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      {/* Modal panel — stop click from bubbling to backdrop */}
      <div
        className="bg-bg-card border border-border-color rounded-2xl p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-text-primary">🔀 Shuffle</h2>
            <p className="text-text-muted text-sm truncate max-w-[280px]">{playlistName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Shuffle options */}
        <div className="flex flex-col gap-3 mb-6">
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
                  {isChecked && <span className="text-white text-xs">✓</span>}
                </div>
                <div>
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
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-bg-secondary hover:bg-bg-primary text-text-muted font-semibold py-3 rounded-full border border-border-color transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onShuffle(algorithms)}
            disabled={noneSelected || isLoading}
            className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          >
            {isLoading ? 'Shuffling...' : 'Shuffle'}
          </button>
        </div>
      </div>
    </div>
  );
}