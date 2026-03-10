import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchTracksPage } from '../api/tracks';
import type { Track, PlaylistAverages } from '../api/tracks';
import { formatDuration } from '../api/tracks';
import AudioFeatureChart from '../components/AudioFeatureChart';
import { AUDIO_FEATURES } from '../constants/audioFeatures';
import PlaylistCompositionCharts from '../components/PlaylistCompositionCharts';
import ShuffleModal from '../components/ShuffleModal';
import { copyPlaylist, savePlaylist } from '../api/playlists';
import { applyShuffle } from '../utils/shuffleAlgorithms';

const getUserId = () => sessionStorage.getItem('userId') || '';
const getSpotifyId = () => sessionStorage.getItem('spotifyId') || '';

// Recalculates playlist averages from the full set of loaded tracks
// Called after each page loads so the charts stay up to date as tracks stream in
const recalculateAverages = (tracks: Track[]): PlaylistAverages => {
  const avg = (key: keyof PlaylistAverages) => {
    const values = tracks
      .map(t => t.audioFeatures[key])
      .filter(v => v !== null) as number[];
    return values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      : null;
  };

  const tempos = tracks
    .map(t => t.audioFeatures.tempo)
    .filter(v => v !== null) as number[];

  return {
    energy: avg('energy'),
    danceability: avg('danceability'),
    valence: avg('valence'),
    acousticness: avg('acousticness'),
    instrumentalness: avg('instrumentalness'),
    speechiness: avg('speechiness'),
    tempo: tempos.length
      ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
      : null,
  };
};

export default function PlaylistDetail() {
  const { spotifyId } = useParams<{ spotifyId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { ownerId, name } = (location.state || {}) as { ownerId?: string; name?: string };
  const isOwner = ownerId === getSpotifyId();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [averages, setAverages] = useState<PlaylistAverages | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const [shuffleModalOpen, setShuffleModalOpen] = useState(false);

  const [isShuffled, setIsShuffled] = useState(false);
  const [originalTracks, setOriginalTracks] = useState<Track[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!spotifyId) return;

    // Reset state when playlist changes
    setTracks([]);
    setAverages(null);
    setLoading(true);
    setLoadingMore(false);

    let cancelled = false;

    // Loads all remaining pages after the first page has already been shown
    // Runs in the background so the user isn't blocked waiting for large playlists
    const loadAllPages = async (startPage: number) => {
      let currentPage = startPage;
      let more = true;
      setLoadingMore(true);

      while (more && !cancelled) {
        try {
          const data = await fetchTracksPage(getUserId(), spotifyId, currentPage);
          if (cancelled) break;

          setTracks(prev => {
            const updated = [...prev, ...data.tracks];
            setAverages(recalculateAverages(updated));
            return updated;
          });

          more = data.hasMore;
          currentPage = data.nextPage;
        } catch {
          console.error(`Failed to load page ${currentPage}`);
          break;
        }
      }

      if (!cancelled) setLoadingMore(false);
    };

    // Load the first page immediately, then kick off background loading for the rest
    fetchTracksPage(getUserId(), spotifyId, 0)
      .then(data => {
        if (cancelled) return;
        setTracks(data.tracks);
        setAverages(data.playlistAverages);
        setTotal(data.total);
        setLoading(false);

        if (data.hasMore) loadAllPages(data.nextPage);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Failed to load tracks');
        setLoading(false);
      });

    // If spotifyId changes before loading finishes, cancel the in-flight requests
    return () => { cancelled = true; };
  }, [spotifyId]);

  // Applies the chosen shuffle algorithms to the current track list in memory
  // Saves the original order on first shuffle so the user can undo
  const handleShuffle = (algorithms: {
    trueRandom: boolean;
    artistSpread: boolean;
    genreSpread: boolean;
    chronological: boolean;
  }) => {
    if (!isShuffled) setOriginalTracks([...tracks]);
    setTracks(applyShuffle(tracks, algorithms));
    setIsShuffled(true);
    setShuffleModalOpen(false);
  };

  // Writes the current track order to the user's owned Spotify playlist
  const handleSave = async () => {
    if (!spotifyId) return;
    setSaveLoading(true);
    setSaveError(null);

    try {
      await savePlaylist(getUserId(), spotifyId, tracks);
      setIsShuffled(false);
      setSaveSuccess('Playlist saved successfully!');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch {
      setSaveError('Spotify restricts playlist modifications in development mode. This will work once the app is published.');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaveLoading(false);
    }
  };

  // Creates a new copy of the playlist in the user's Spotify library
  // Used for playlists the user doesn't own, where saving in-place isn't allowed
  const handleSaveAsCopy = async () => {
    if (!spotifyId) return;
    setSaveLoading(true);
    setSaveError(null);

    try {
      const { playlist: newPlaylist } = await copyPlaylist(
        getUserId(),
        tracks,
        name || 'My Playlist'
      );
      setIsShuffled(false);
      setSaveSuccess('Copy saved to your library!');
      setTimeout(() => setSaveSuccess(null), 3000);
      window.open(`/playlist/${newPlaylist.spotifyId}`, '_blank');
    } catch {
      setSaveError('Spotify restricts playlist modifications in development mode. This will work once the app is published.');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-accent text-xl animate-pulse">Loading playlist...</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <p className="text-4xl mb-4">{isOwner ? '⚠️' : '🔒'}</p>
        <p className="text-text-primary text-lg font-semibold mb-2">
          {isOwner ? 'Something went wrong' : 'Playlist Unavailable'}
        </p>
        <p className="text-text-muted text-sm mb-2">{error}</p>
        {!isOwner && (
          <p className="text-text-muted text-sm mb-6">
            Tunecraft can only access playlists you own. Playlists created by other users are restricted.
          </p>
        )}
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-6 py-3 rounded-full transition-all duration-200"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">

      {/* Header */}
      <div className="border-b border-border-color px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-text-muted hover:text-text-primary transition-colors duration-200"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tune<span className="text-accent">craft</span>
            </h1>
            {name && <p className="text-lg font-semibold">{name}</p>}
            {/* Shows live loading progress as pages stream in */}
            <p className="text-text-muted text-sm">
              {loadingMore
                ? `Loading... ${tracks.length} of ${total} tracks`
                : `${tracks.length} tracks`
              }
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShuffleModalOpen(true)}
            className="bg-accent hover:bg-accent-hover text-white font-semibold px-5 py-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          >
            🔀 Shuffle
          </button>
          {isOwner && spotifyId !== 'liked' && (
            <button
              onClick={handleSave}
              disabled={saveLoading}
              className="bg-bg-card hover:bg-bg-secondary disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full border border-border-color transition-all duration-200 hover:border-accent/50"
            >
              {saveLoading ? 'Saving...' : '💾 Save'}
            </button>
          )}
          <button
            onClick={handleSaveAsCopy}
            disabled={saveLoading}
            className="bg-bg-card hover:bg-bg-secondary disabled:opacity-50 text-text-primary font-semibold px-5 py-2 rounded-full border border-border-color transition-all duration-200 hover:border-accent/50"
          >
            {saveLoading ? 'Saving...' : '💾 Save as Copy'}
          </button>
        </div>
      </div>

      {/* Unsaved changes banner */}
      {isShuffled && (
        <div className="bg-accent/10 px-8 py-3 flex items-center justify-between">
          <p className="text-accent text-sm font-medium">
            ✨ Playlist shuffled — save to apply changes
          </p>
          <button
            onClick={() => {
              setTracks(originalTracks);
              setIsShuffled(false);
            }}
            className="text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            ↩ Undo
          </button>
        </div>
      )}

      <div className="px-8 py-2">

        {/* Collapsible Insights Section */}
        <div className="mb-8 bg-bg-card rounded-2xl border border-border-color overflow-hidden">
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-secondary transition-colors duration-200"
          >
            <span className="text-sm font-semibold uppercase tracking-widest text-text-muted">
              Playlist Insights
              {loadingMore && (
                <span className="ml-2 text-accent/60 normal-case tracking-normal font-normal">
                  — updating as tracks load
                </span>
              )}
            </span>
            <span
              className="text-text-muted transition-transform duration-300"
              style={{ transform: insightsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ▼
            </span>
          </button>

          {insightsOpen && averages && (
            <div className="px-6 pb-6">
              {/* Row 1 — Audio feature donut charts */}
              <div className="grid grid-cols-4 md:grid-cols-7 gap-6 justify-items-center mb-8">
                {AUDIO_FEATURES.map(feature => (
                  <AudioFeatureChart
                    key={feature.key}
                    label={feature.label}
                    value={averages[feature.key as keyof PlaylistAverages]}
                    isTempo={feature.isTempo}
                    isLoading={loadingMore}
                  />
                ))}
              </div>

              {/* Row 2 — Genre and decade pie charts */}
              <PlaylistCompositionCharts
                tracks={tracks}
                isLoading={loadingMore}
              />
            </div>
          )}
        </div>

        {/* Track list */}
        <div className="flex flex-col gap-2">
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className="group flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-bg-card transition-colors duration-200"
            >
              <span className="text-text-muted text-sm w-6 text-right shrink-0">
                {index + 1}
              </span>
              <div className="w-10 h-10 rounded-md overflow-hidden bg-bg-secondary shrink-0">
                {track.albumImageUrl ? (
                  <img
                    src={track.albumImageUrl}
                    alt={track.albumName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted">
                    🎵
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{track.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-text-muted text-xs truncate">{track.artist}</p>
                  {track.genres.slice(0, 2).map(genre => (
                    <span
                      key={genre}
                      className="text-accent text-xs bg-accent/10 px-2 py-0.5 rounded-full shrink-0"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-text-muted text-xs w-16 text-center shrink-0">
                {track.audioFeatures.tempo
                  ? `${Math.round(track.audioFeatures.tempo)} BPM`
                  : '—'
                }
              </div>
              <span className="text-text-muted text-sm w-10 text-right shrink-0">
                {formatDuration(track.durationMs)}
              </span>
            </div>
          ))}
        </div>

        {/* Background loading indicator at bottom of list */}
        {loadingMore && (
          <div className="flex justify-center py-8">
            <div className="text-accent/60 text-sm animate-pulse">
              Loading remaining tracks in background...
            </div>
          </div>
        )}
      </div>

      {/* Success toast */}
      {saveSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-3 rounded-full shadow-lg z-50">
          ✅ {saveSuccess}
        </div>
      )}

      {/* Failure toast */}
      {saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-lg z-50 text-center max-w-md">
          ⚠️ {saveError}
        </div>
      )}

      {/* Shuffle modal */}
      <ShuffleModal
        isOpen={shuffleModalOpen}
        isOwner={isOwner}
        playlistName={name || 'Playlist'}
        onClose={() => setShuffleModalOpen(false)}
        onShuffle={handleShuffle}
        isLoading={false}
      />
    </div>
  );
}