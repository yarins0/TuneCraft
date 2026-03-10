import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPlaylists, fetchLikedSongs } from '../api/playlists';
import type { Playlist } from '../api/playlists';
import { extractPlaylistId } from '../utils/spotify';
import { discoverPlaylist } from '../api/playlists';

const getUserId = () => sessionStorage.getItem('userId') || '';
const getSpotifyId = () => sessionStorage.getItem('spotifyId');

export default function Dashboard() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedCount, setLikedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discoverInput, setDiscoverInput] = useState('');
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
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

  // Handles the discover form submission
  // Parses the input, fetches playlist metadata, then navigates to the detail page
  const handleDiscover = async () => {
    setDiscoverError(null);
    const playlistId = extractPlaylistId(discoverInput);

    if (!playlistId) {
      setDiscoverError('Please enter a valid Spotify playlist URL or ID');
      return;
    }

    setDiscoverLoading(true);

    try {
      const playlist = await discoverPlaylist(getUserId(), playlistId);
      navigate(`/playlist/${playlist.spotifyId}`, {
        state: { ownerId: playlist.ownerId, name: playlist.name },
      });
    } catch (error: any) {
      setDiscoverError(error.message);
    } finally {
      setDiscoverLoading(false);
    }
  };

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

    // Split playlists into owned and following groups
  const ownedPlaylists = playlists.filter(p => p.ownerId === getSpotifyId());
  const followingPlaylists = playlists.filter(p => p.ownerId !== getSpotifyId());

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <div className="border-b border-border-color px-8 py-6">
        <h1
          onClick={() => navigate('/dashboard')}
          className="text-3xl font-bold tracking-tight cursor-pointer w-fit"
        >
          Tune<span className="text-accent">Craft</span>
        </h1>
        <p className="text-text-muted text-sm mt-1">Your music, engineered.</p>
      </div>

      <div className="px-8 py-10">
        {/* Playlist Discovery Search Bar */}
        <div className="mb-8">
          <p className="text-text-muted text-sm mb-3 uppercase tracking-widest font-semibold">
            Discover any playlist
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={discoverInput}
              onChange={e => {
                setDiscoverInput(e.target.value);
                setDiscoverError(null);
              }}
              onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              placeholder="Paste a Spotify playlist URL or ID..."
              className="flex-1 bg-bg-card border border-border-color rounded-full px-5 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors duration-200"
            />
            <button
              onClick={handleDiscover}
              disabled={discoverLoading || !discoverInput.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
            >
              {discoverLoading ? 'Loading...' : 'Go'}
            </button>
          </div>
          {discoverError && (
            <p className="text-red-400 text-sm mt-2 ml-2">{discoverError}</p>
          )}
        </div>

        {/* Group 1 — Liked Songs + Owned Playlists */}
        <div className="mb-10">
          <p className="text-text-muted text-sm mb-4 uppercase tracking-widest font-semibold">
            Your Library <span className="text-accent normal-case">· {ownedPlaylists.length + 1}</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

            {/* Liked Songs card — always first */}
            <div
              onClick={() => navigate('/playlist/liked', {
                state: { ownerId: getSpotifyId(), name: 'Liked Songs' }
              })}
              className="group bg-bg-card rounded-2xl overflow-hidden border border-border-color hover:border-accent/50 transition-all duration-300 hover:bg-bg-secondary cursor-pointer"
            >
              <div className="aspect-square w-full bg-gradient-to-br from-purple-900 to-accent/30 flex items-center justify-center">
                <span className="text-8xl">💜</span>
              </div>
              <div className="p-4">
                <p className="font-semibold text-sm">Liked Songs</p>
                <p className="text-text-muted text-xs mt-1">{likedCount ?? '...'} tracks</p>
              </div>
            </div>

            {/* Owned playlists */}
            {ownedPlaylists.map(playlist => (
              <div
              key={playlist.spotifyId}
              onClick={() => navigate(`/playlist/${playlist.spotifyId}`, {
                state: { ownerId: playlist.ownerId, name: playlist.name }
              })}
              className="group bg-bg-card rounded-2xl overflow-hidden border border-border-color hover:border-accent/50 transition-all duration-300 hover:bg-bg-secondary cursor-pointer"
              >
                <div className="aspect-square w-full bg-bg-secondary overflow-hidden">
                  {playlist.imageUrl ? (
                    <img
                      src={playlist.imageUrl}
                      alt={playlist.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">
                      🎵
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

        {/* Group 2 — Following */}
        {followingPlaylists.length > 0 && (
          <div>
            <p className="text-text-muted text-sm mb-4 uppercase tracking-widest font-semibold">
              Following <span className="text-accent normal-case">· {followingPlaylists.length}</span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {followingPlaylists.map(playlist => (
                <div
                key={playlist.spotifyId}
                onClick={() => navigate(`/playlist/${playlist.spotifyId}`, {
                  state: { ownerId: playlist.ownerId, name: playlist.name }
                })}
                className="group bg-bg-card rounded-2xl overflow-hidden border border-border-color hover:border-accent/50 transition-all duration-300 hover:bg-bg-secondary cursor-pointer opacity-75"
                >
                  <div className="aspect-square w-full bg-bg-secondary overflow-hidden">
                    {playlist.imageUrl ? (
                      <img
                        src={playlist.imageUrl}
                        alt={playlist.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">
                        🎵
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-semibold text-sm truncate">{playlist.name}</p>
                    <p className="text-text-muted text-xs mt-1">{playlist.trackCount} tracks</p>
                    <p className="text-accent text-xs mt-1">Following</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}