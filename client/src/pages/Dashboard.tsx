import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPlaylists, fetchLikedSongs } from '../api/playlists';
import type { Playlist } from '../api/playlists';

const getUserId = () => sessionStorage.getItem('userId');
const getSpotifyId = () => sessionStorage.getItem('spotifyId');

export default function Dashboard() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedCount, setLikedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const userId = getUserId();

    if (!userId) {
      setError('No user session found. Please log in again.');
      setLoading(false);
      return;
    }

    // Fetch both playlists and liked songs count in parallel
    Promise.all([
      fetchPlaylists(userId),
      fetchLikedSongs(userId),
    ])
      .then(([playlistData, likedData]) => {
        setPlaylists(playlistData);
        setLikedCount(likedData.trackCount);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load playlists');
        setLoading(false);
      });
  }, []);

  // Determines if the current user owns a playlist
  const isOwned = (playlist: Playlist) =>
    playlist.ownerId === getSpotifyId();

  if (loading) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading your music...</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-red-400 text-xl">{error}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <div className="border-b border-border-color px-8 py-6">
        <h1 className="text-3xl font-bold tracking-tight">
          Tune<span className="text-accent">craft</span>
        </h1>
        <p className="text-text-muted text-sm mt-1">Your music, engineered.</p>
      </div>

      <div className="px-8 py-10">
        {/* Stats bar */}
        <div className="flex gap-8 mb-10">
          <div className="bg-bg-card rounded-2xl px-6 py-4 border border-border-color">
            <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Playlists</p>
            <p className="text-3xl font-bold text-accent">{playlists.length}</p>
          </div>
          <div className="bg-bg-card rounded-2xl px-6 py-4 border border-border-color">
            <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Liked Songs</p>
            <p className="text-3xl font-bold text-accent">{likedCount ?? '...'}</p>
          </div>
          <div className="bg-bg-card rounded-2xl px-6 py-4 border border-border-color">
            <p className="text-text-muted text-xs uppercase tracking-widest mb-1">Total Tracks</p>
            <p className="text-3xl font-bold text-accent">
              {playlists.reduce((sum, p) => sum + p.trackCount, 0) + (likedCount ?? 0)}
            </p>
          </div>
        </div>

        {/* Playlists grid */}
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Your Library</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">

          {/* Liked Songs card — always first */}
          <div
            onClick={() => navigate('/playlist/liked', {
              state: { ownerId: getSpotifyId(), name: 'Liked Songs' }
            })}
            className="group bg-bg-card rounded-2xl overflow-hidden border border-border-color hover:border-accent/50 transition-all duration-300 hover:bg-bg-secondary cursor-pointer"
          >
            <div className="aspect-square w-full bg-gradient-to-br from-purple-900 to-accent/30 flex items-center justify-center">
              <span className="text-5xl">💜</span>
            </div>
            <div className="p-4">
              <p className="font-semibold text-sm">Liked Songs</p>
              <p className="text-text-muted text-xs mt-1">{likedCount ?? '...'} tracks</p>
            </div>
          </div>

          {/* Regular playlist cards */}
          {playlists.map(playlist => (
            <div
              key={playlist.spotifyId}
              onClick={() => navigate(`/playlist/${playlist.spotifyId}`, {
                state: { ownerId: playlist.ownerId, name: playlist.name }
              })}
              className="group bg-bg-card rounded-2xl overflow-hidden border border-border-color hover:border-accent/50 transition-all duration-300 hover:bg-bg-secondary cursor-pointer"
            >
              <div className="aspect-square w-full overflow-hidden bg-bg-secondary relative">
                {playlist.imageUrl ? (
                  <img
                    src={playlist.imageUrl}
                    alt={playlist.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted text-4xl">
                    🎵
                  </div>
                )}
                {/* Ownership badge */}
                {!isOwned(playlist) && (
                  <div className="absolute top-2 right-2 bg-black/60 text-text-muted text-xs px-2 py-1 rounded-full">
                    following
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="font-semibold text-sm truncate">{playlist.name}</p>
                <p className="text-text-muted text-xs mt-1">{playlist.trackCount} tracks</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}