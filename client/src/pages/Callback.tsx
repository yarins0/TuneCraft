import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Handles the redirect from the Tunecraft backend after Spotify OAuth completes.
// Reads the userId from the URL and stores it in session storage.
export default function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    const userId = new URLSearchParams(window.location.search).get('userId');
    const spotifyId = new URLSearchParams(window.location.search).get('spotifyId');

    if (userId && spotifyId) {
      sessionStorage.setItem('userId', userId);
      sessionStorage.setItem('spotifyId', spotifyId);
      navigate('/dashboard');
    }
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Connecting to Spotify...</div>
    </div>
  );
}