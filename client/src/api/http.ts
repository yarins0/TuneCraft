import { getAuthHeaders, getActiveAccount, forgetAccountLocally } from '../utils/accounts';

// Guards against firing multiple redirects when several requests fail with 401 at
// once — e.g. the dashboard issuing parallel calls right after a token expires.
let isHandlingReauth = false;

// Called when the server reports the active account's session is no longer valid
// (HTTP 401 — an expired refresh token or a rejected auth header).
//
// Forgets only the dead account locally: other connected platform accounts and the
// server-side row (with its reshuffle schedules) are preserved, so signing in again
// restores everything. A full-page navigation guarantees all in-memory state is dropped.
const handleReauthRequired = (): void => {
  if (isHandlingReauth) return;
  isHandlingReauth = true;

  const active = getActiveAccount();
  if (active) forgetAccountLocally(active.userId);

  window.location.href = '/?error=session_expired';
};

// Thin fetch wrapper shared by every API module.
//
// Injects the X-User-Token auth header and centralises 401 handling so a single
// expired session sends the user back through sign-in from anywhere in the app.
// Any caller-supplied init (method, body, signal, Content-Type) is preserved.
export const apiFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const headers = { ...(init.headers as Record<string, string> | undefined), ...getAuthHeaders() };
  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    handleReauthRequired();
    throw new Error('Session expired — redirecting to sign in');
  }

  return response;
};
