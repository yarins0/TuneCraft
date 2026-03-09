// Extracts a Spotify playlist ID from either a full URL or a raw ID
// Handles formats like:
//   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
//   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123
//   37i9dQZF1DXcBWIGoYBM5M
export const extractPlaylistId = (input: string): string | null => {
    const trimmed = input.trim();
  
    // If it looks like a URL, extract the ID from the path
    if (trimmed.includes('spotify.com/playlist/')) {
      const match = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }
  
    // If it looks like a raw Spotify ID (22 alphanumeric characters)
    if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
      return trimmed;
    }
  
    return null;
  };