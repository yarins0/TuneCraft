import axios from 'axios';

// Thrown when a stored refresh token is no longer valid — for example, a Spotify
// refresh token that has passed its six-month expiry (or been revoked) and whose
// token endpoint now returns invalid_grant.
//
// This is a terminal failure, not a transient one: the token must be discarded
// and the user sent back through the sign-in flow. It must never be retried.
export class ReauthRequiredError extends Error {
  constructor(public readonly platform: string) {
    super(`Re-authentication required for platform: ${platform}`);
    this.name = 'ReauthRequiredError';
  }
}

// Detects the OAuth invalid_grant response returned when a refresh token has
// expired or been revoked. Spotify — and OAuth 2.0 providers generally — return
// this as HTTP 400 with { error: 'invalid_grant' } in the response body.
export const isInvalidGrantError = (error: unknown): boolean =>
  axios.isAxiosError(error) &&
  error.response?.status === 400 &&
  (error.response?.data as { error?: string } | undefined)?.error === 'invalid_grant';
