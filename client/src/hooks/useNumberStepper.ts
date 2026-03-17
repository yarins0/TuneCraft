import { useCallback } from 'react';

// Provides increment/decrement helpers and a keyboard handler for a controlled
// numeric string input. Arrow key direction is intentionally reversed from the
// browser default so that ↑ moves to a smaller number (earlier in a list) and
// ↓ moves to a larger number (later in a list).
//
// value    — the current string value of the input (controlled externally)
// setValue — the setter from the parent's useState
// min      — lowest allowed value (inclusive)
// max      — highest allowed value (inclusive)
const useNumberStepper = (
  value: string,
  setValue: (v: string) => void,
  min: number,
  max: number
) => {
  const clamp = (n: number) => Math.min(Math.max(n, min), max);

  // ↑ button / ArrowUp key → move earlier in the list (smaller number)
  const decrement = useCallback(() => {
    setValue(String(clamp((parseInt(value, 10) || min) - 1)));
  }, [value, min, max]);

  // ↓ button / ArrowDown key → move later in the list (larger number)
  const increment = useCallback(() => {
    setValue(String(clamp((parseInt(value, 10) || min) + 1)));
  }, [value, min, max]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); decrement(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); increment(); }
  }, [decrement, increment]);

  return { increment, decrement, handleKeyDown };
};

export default useNumberStepper;
