import axios from 'axios';

// Pauses execution for ms milliseconds.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Generic HTTP request wrapper with automatic 429 rate-limit retry.
//
// Both the Spotify and SoundCloud adapters use this instead of duplicating retry logic.
// The label parameter is included in warning logs to identify which API is rate-limiting.
//
// Behaviour:
//   - On 429: reads Retry-After header (default 5s, capped at 30s), waits, retries.
//   - On any other error: rethrows immediately (no silent swallowing).
//   - After maxRetries exhausted: rethrows the last error.
export const requestWithRetry = async (
  method: 'get' | 'post' | 'put',
  url: string,
  config: object,
  data?: any,
  maxRetries = 3,
  label = 'API'
): Promise<any> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (method === 'get') return await axios.get(url, config);
      if (method === 'post') return await axios.post(url, data, config);
      if (method === 'put') return await axios.put(url, data, config);
    } catch (error: any) {
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.['retry-after'];
      if (status === 429 && attempt < maxRetries - 1) {
        const waitSeconds = Math.min(retryAfter ? parseInt(retryAfter) : 5, 30);
        console.warn(`${label} rate limit hit — waiting ${waitSeconds}s (retry ${attempt + 1}/${maxRetries})`);
        await sleep(waitSeconds * 1000);
        continue;
      }
      throw error;
    }
  }
};
