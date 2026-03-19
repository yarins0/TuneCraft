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

  const activeId = localStorage.getItem('activeUserId');
  // Fall back to the first account if activeUserId points to a removed account.
  return accounts.find(a => a.userId === activeId) ?? accounts[0];
}

// Switches the active account and syncs the legacy 'userId' key.
export function setActiveAccount(userId: string): void {
  const accounts = getAccounts();
  const account = accounts.find(a => a.userId === userId);
  if (!account) return;

  localStorage.setItem('activeUserId', userId);
  // Keep legacy keys in sync so existing API call code keeps working.
  localStorage.setItem('userId', account.userId);
  localStorage.setItem('platformUserId', account.platformUserId);
}

// Removes all stored accounts and resets all auth keys.
// Used on logout.
export function clearAccounts(): void {
  localStorage.removeItem('accounts');
  localStorage.removeItem('activeUserId');
  localStorage.removeItem('userId');
  localStorage.removeItem('platformUserId');
}
