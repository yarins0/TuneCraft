import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  PlatformMismatchScreen,
  PlaylistLoadingScreen,
  PlaylistErrorScreen,
} from '../components/ui';
import { PLATFORM_LABELS } from '../utils/platform';

// Minimal platform config shape used by PlaylistErrorScreen
const makePlatformConfig = (ownershipRestricted: boolean) =>
  ({
    label:                'Spotify',
    ownershipRestricted,
    icon:                 '🎵',
    cssVar:               '--color-platform-spotify',
    available:            true,
    requiresAccessRequest: false,
    followedPlaylistsSupported: true,
    totalTracksReliable:  true,
    audioFeaturesMissingHint: undefined,
    trackUrl:    () => '#',
    playlistUrl: () => '#',
    extractPlaylistId: () => null,
  } as any);

describe('PlatformMismatchScreen', () => {
  it('renders the human-readable platform names from PLATFORM_LABELS', () => {
    render(
      <MemoryRouter>
        <PlatformMismatchScreen
          playlistPlatform="SPOTIFY"
          activeAccountPlatform="SOUNDCLOUD"
        />
      </MemoryRouter>
    );

    // PLATFORM_LABELS resolves the registry keys to their display names
    expect(screen.getByText(PLATFORM_LABELS['SPOTIFY'])).toBeInTheDocument();
    expect(screen.getByText(PLATFORM_LABELS['SOUNDCLOUD'])).toBeInTheDocument();
  });

  it('falls back to the raw key when the platform is not in the registry', () => {
    render(
      <MemoryRouter>
        <PlatformMismatchScreen
          playlistPlatform="UNKNOWN_PLATFORM"
          activeAccountPlatform="ANOTHER_UNKNOWN"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('UNKNOWN_PLATFORM')).toBeInTheDocument();
    expect(screen.getByText('ANOTHER_UNKNOWN')).toBeInTheDocument();
  });
});

describe('PlaylistLoadingScreen', () => {
  it('renders the animated loading pulse text', () => {
    render(<PlaylistLoadingScreen />);
    expect(screen.getByText('Loading playlist...')).toBeInTheDocument();
  });
});

describe('PlaylistErrorScreen', () => {
  it('shows a lock icon and "Playlist Unavailable" when isOwner is false and ownershipRestricted is true', () => {
    render(
      <MemoryRouter>
        <PlaylistErrorScreen
          isOwner={false}
          platformConfig={makePlatformConfig(true)}
          error="Access denied"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('🔒')).toBeInTheDocument();
    expect(screen.getByText('Playlist Unavailable')).toBeInTheDocument();
    // The ownership-restriction message names the platform
    expect(screen.getByText(/restricts access/i)).toBeInTheDocument();
  });

  it('shows a warning icon and "Something went wrong" when the error is not an ownership block', () => {
    render(
      <MemoryRouter>
        <PlaylistErrorScreen
          isOwner={true}
          platformConfig={makePlatformConfig(false)}
          error="Unexpected failure"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('⚠️')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows the cross-platform hint for non-ownership errors', () => {
    render(
      <MemoryRouter>
        <PlaylistErrorScreen
          isOwner={true}
          platformConfig={makePlatformConfig(false)}
          error="Something broke"
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/different platform/i)).toBeInTheDocument();
  });
});
