// accounts.ts — multi-account localStorage management
//
// TuneCraft supports multiple connected streaming platform accounts in the same
// browser session. Each account is stored as a StoredAccount in the 'accounts'
// array. The 'activeUserId' key tracks which account is currently active.
//
// Backwards compatibility: older sessions stored just 'userId' and 'platformUserId'
// directly. getActiveAccount() detects this and migrates transparently.

export interface StoredAccount {
  userId: string;       // internal DB cuid
  platformUserId: string; // platform's own user ID (Spotify/SoundCloud ID)
  platform: string;     // 'SPOTIFY' | 'SOUNDCLOUD'
  displayName: string;
}

// Reads all stored accounts from localStorage.
// Returns an empty array if none are stored.
export function getAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem('accounts');
    if (!raw) return [];
    return JSON.parse(raw) as StoredAccount[];
  } catch {
    return [];
  }
}

// Persists the full accounts array to localStorage.
function saveAccounts(accounts: StoredAccount[]): void {
  localStorage.setItem('accounts', JSON.stringify(accounts));
}

// Adds or updates an account in the stored list.
// If an account with the same userId already exists, its fields are updated
// (e.g. a refreshed displayName after re-login). Otherwise the account is appended.
export function upsertAccount(account: StoredAccount): void {
  const accounts = getAccounts();
  const existingIndex = accounts.findIndex(a => a.userId === account.userId);

  if (existingIndex >= 0) {
    accounts[existingIndex] = account;
  } else {
    accounts.push(account);
  }

  saveAccounts(accounts);

  // Keep legacy 'userId' / 'platformUserId' keys in sync so existing code
  // that reads them directly continues to work.
  const activeId = localStorage.getItem('activeUserId') ?? account.userId;
  if (activeId === account.userId) {
    localStorage.setItem('userId', account.userId);
    localStorage.setItem('platformUserId', account.platformUserId);
  }
}

// Returns the currently active account.
//
// Migration path: if no 'accounts' array exists but a legacy 'userId' key does,
// creates a SPOTIFY stub account so the session keeps working without re-login.
export function getActiveAccount(): StoredAccount | null {
  const accounts = getAccounts();

  // --- Legacy migration ---
  const legacyUserId = localStorage.getItem('userId');
  const legacyPlatformUserId = localStorage.getItem('platformUserId');
  if (accounts.length === 0 && legacyUserId && legacyPlatformUserId) {
    const stub: StoredAccount = {
      userId: legacyUserId,
      platformUserId: legacyPlatformUserId,
      platform: 'SPOTIFY',
      displayName: '',
    };
    upsertAccount(stub);
    localStorage.setItem('activeUserId', legacyUserId);
    return stub;
  }

  if (accounts.length === 0) return null;

  // sessionStorage takes priority — it's a per-tab override written by setSessionAccount()
  // when the tab was opened via "open in new tab" from the account switcher.
  const activeId = sessionStorage.getItem('activeUserId') ?? localStorage.getItem('activeUserId');
  // Fall back to the first account if activeUserId points to a removed account.
  return accounts.find(a => a.userId === activeId) ?? accounts[0];
}

// Switches the active account for the current tab and persists it globally.
//
// Writes to both localStorage (global default) and sessionStorage (per-tab override).
// sessionStorage must be kept in sync because getUserId() reads it first — without this,
// a tab that has a sessionStorage override (e.g. opened via ?switchTo) would ignore
// the account switch and keep returning the stale sessionStorage value.
export function setActiveAccount(userId: string): void {
  const accounts = getAccounts();
  const account = accounts.find(a => a.userId === userId);
  if (!account) return;

  localStorage.setItem('activeUserId', userId);
  localStorage.setItem('userId', account.userId);
  localStorage.setItem('platformUserId', account.platformUserId);

  // Mirror to sessionStorage so this tab's getUserId() sees the update immediately.
  // sessionStorage is per-tab so other open tabs are not affected.
  sessionStorage.setItem('activeUserId', userId);
  sessionStorage.setItem('userId', account.userId);
  sessionStorage.setItem('platformUserId', account.platformUserId);
}

// Activates an account for the current tab only, without touching localStorage.
//
// localStorage is shared across every tab — writing to it from a new tab would
// switch the account in the original tab too. sessionStorage is isolated per tab,
// so this is used when a tab is opened via the "open in new tab" flow.
//
// getActiveAccount() and getUserId() check sessionStorage first, so the tab
// behaves as if this account is active without affecting any other tab.
export function setSessionAccount(userId: string): void {
  const accounts = getAccounts(); // the accounts list itself lives in localStorage and is shared — that's fine
  const account = accounts.find(a => a.userId === userId);
  if (!account) return;

  sessionStorage.setItem('activeUserId', userId);
  // Mirror the legacy keys so getUserId() / getPlatformUserId() picks them up.
  sessionStorage.setItem('userId', account.userId);
  sessionStorage.setItem('platformUserId', account.platformUserId);
}

// Removes a single account from the stored list and cleans up related keys.
//
// If the removed account was the active one, the legacy 'userId' / 'platformUserId'
// keys are cleared so no stale identity lingers. The caller is responsible for
// redirecting to login or switching to another account after this returns.
//
// Also calls DELETE /auth/:userId on the server to remove the User row from the DB.
// The server deletes only that row — other platform accounts in the same browser
// session are not affected.
export async function removeAccount(userId: string): Promise<void> {
  const { API_BASE_URL } = await import('../api/config');

  // Fire-and-forget the server deletion; if it fails we still clean up locally
  // so the user isn't stuck. A 404 (row already gone) is also fine.
  try {
    await fetch(`${API_BASE_URL}/auth/${userId}`, { method: 'DELETE' });
  } catch {
    // Network error — proceed with local cleanup regardless
  }

  // Remove the account from the local array
  const accounts = getAccounts();
  const updated = accounts.filter(a => a.userId !== userId);
  saveAccounts(updated);

  // Clean up active-account keys if this was the active one
  const activeId = localStorage.getItem('activeUserId');
  if (activeId === userId) {
    localStorage.removeItem('activeUserId');
    localStorage.removeItem('userId');
    localStorage.removeItem('platformUserId');

    // Mirror the removal into sessionStorage as well — getUserId() checks it first
    sessionStorage.removeItem('activeUserId');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('platformUserId');
  }
}

// Removes all stored accounts and resets all auth keys.
// Used on logout.
export function clearAccounts(): void {
  localStorage.removeItem('accounts');
  localStorage.removeItem('activeUserId');
  localStorage.removeItem('userId');
  localStorage.removeItem('platformUserId');
}
