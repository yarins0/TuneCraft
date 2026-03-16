import { useState, useEffect } from 'react';

// Cycles a loading label through one, two, and three trailing dots
// while isLoading is true, updating every 400ms.
// Returns the plain baseText string when isLoading is false.
//
// Usage:
//   const label = useAnimatedLabel(isSaving, 'Saving');
//   // → 'Saving' | 'Saving.' | 'Saving..' | 'Saving...'
export function useAnimatedLabel(isLoading: boolean, baseText: string): string {
  // Tracks how many dots are currently shown (1, 2, or 3)
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    // Nothing to animate when not loading — reset dots for next time
    if (!isLoading) {
      setDotCount(1);
      return;
    }

    // Advance the dot count on a fixed interval, wrapping 3 → 1
    const interval = setInterval(() => {
      setDotCount(prev => (prev === 3 ? 1 : prev + 1));
    }, 400);

    // Cleanup: clear the interval when isLoading turns false
    // or when the component using this hook unmounts.
    // Without this, the interval would keep firing after it's no longer needed.
    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading) return baseText;

  // Build the animated string: baseText + n dots
  return `${baseText}${'.'.repeat(dotCount)}`;
}
