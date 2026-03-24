import axios from 'axios';

// Pauses execution for ms milliseconds.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Waits for ms milliseconds, but rejects early if the AbortSignal fires first.
// This prevents back-off waits from blocking after the caller has already given up —
// e.g. when the user navigates away mid-retry and the route's AbortController fires.
//
// How it works:
//   - Creates a Promise that resolves after `ms` ms (the normal sleep path).
//   - If `signal` is already aborted when this runs, it rejects immediately.
//   - Otherwise, registers a one-time 'abort' listener that rejects the promise and
//     clears the timer so the event loop can drain cleanly.
const sleepOrAbort = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    // Reject immediately if the signal was aborted before we even started waiting.
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    // Schedule the normal timeout resolution.
    const timer = setTimeout(resolve, ms);

    // Register an abort listener that cancels the timer and rejects the promise.
    // { once: true } removes the listener automatically after it fires, preventing leaks.
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

// Generic HTTP request wrapper with automatic 429 rate-limit retry.
//
// Both the Spotify and SoundCloud adapters use this instead of duplicating retry logic.
// The label parameter is included in warning logs to identify which API is rate-limiting.
//
// The optional signal parameter allows callers to cancel in-flight requests and back-off
// waits — for example, when the user navigates away before the response arrives.
// All existing callers are unaffected because signal defaults to undefined.
//
// Behaviour:
//   - On 429: reads Retry-After header (default 5s, capped at 120s), waits, retries.
//   - If the signal fires during a back-off wait, the wait is cut short and the error re-thrown.
//   - If the signal fires before a retry attempt begins, the attempt is skipped immediately.
//   - On any other error: rethrows immediately (no silent swallowing).
//   - After maxRetries exhausted: rethrows the last error.
export const requestWithRetry = async (
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  url: string,
  config: object,
  data?: any,
  maxRetries = 3,
  label = 'API',
  signal?: AbortSignal   // optional 7th argument — all existing callers omit it safely
): Promise<any> => {
  // Merge the signal into the axios config so the active HTTP call is also cancelled
  // the moment the signal fires. Without this, axios would finish the current request
  // even if the caller has already given up.
  const axiosConfig = signal ? { ...config, signal } : config;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check abort state before starting each attempt. This catches the case where the
    // signal fired during a previous back-off wait and avoids a redundant HTTP call.
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    try {
      if (method === 'get')    return await axios.get(url, axiosConfig);
      if (method === 'post')   return await axios.post(url, data, axiosConfig);
      if (method === 'put')    return await axios.put(url, data, axiosConfig);
      if (method === 'delete') return await axios.delete(url, axiosConfig);
      if (method === 'patch')  return await axios.patch(url, data, axiosConfig);
    } catch (error: any) {
      // If axios cancelled the request because the AbortSignal fired, re-throw immediately
      // rather than treating it as a retryable error. axios wraps cancellations in a
      // CanceledError (code === 'ERR_CANCELED') — check that first before inspecting status.
      if (axios.isCancel(error)) throw error;

      const status = error.response?.status;
      const retryAfter = error.response?.headers?.['retry-after'];
      if (status === 429 && attempt < maxRetries - 1) {
        // Respect the full Retry-After value the platform sends — capping at 30s was causing
        // retries to land inside the same rate-limit window and fail again immediately.
        // Cap raised to 120s so a single request can survive realistic rate-limit windows.
        const parsed = retryAfter ? parseInt(retryAfter, 10) : 5;
        const waitSeconds = Math.min(Number.isNaN(parsed) ? 5 : parsed, 120);
        console.warn(`${label} rate limit hit — waiting ${waitSeconds}s (retry ${attempt + 1}/${maxRetries})`);

        // Use sleepOrAbort when a signal is present so we don't waste the full back-off
        // window if the caller already gave up. Fall back to a plain sleep otherwise.
        if (signal) {
          await sleepOrAbort(waitSeconds * 1000, signal);
        } else {
          await sleep(waitSeconds * 1000);
        }
        continue;
      }
      throw error;
    }
  }
};
