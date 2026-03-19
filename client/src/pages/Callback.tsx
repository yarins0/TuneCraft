import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { upsertAccount, setActiveAccount } from '../utils/accounts';

// Handles the redirect from the Tunecraft backend after OAuth completes.
// Works for both Spotify and SoundCloud — the server now includes platform
// and displayName in the redirect URL so we can store a full account record.
// Merges the incoming account into the stored accounts list and makes it active,
// then redirects to the dashboard.
export default function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const platformUserId = params.get('platformUserId');
    const platform = params.get('platform') ?? 'SPOTIFY';
    const displayName = params.get('displayName') ?? '';

    if (userId && platformUserId) {
      // Merge this account into the accounts list (add or update).
      upsertAccount({ userId, platformUserId, platform, displayName });
      // Make the freshly-logged-in account the active one.
      setActiveAccount(userId);
      navigate('/dashboard');
    }
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Connecting...</div>
    </div>
  );
}
