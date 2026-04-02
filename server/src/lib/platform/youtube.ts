import axios from 'axios';
import { requestWithRetry } from '../requestWithRetry';
import {
  fetchEnrichmentMaps,
  type EnrichmentTrack,
} from '../enrichment';
import type {
  PlatformAdapter,
  PlatformPlaylist,
  PlatformTrack,
  PlatformTrackMeta,
  AuthResult,
  TokenRefreshResult,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API      = 'https://www.googleapis.com/youtube/v3';
const USERINFO_URL     = 'https://www.googleapis.com/oauth2/v2/userinfo';
const MUSIC_URL        = 'https://music.youtube.com';

// YouTube Music playlists (and all YouTube playlists) are accessible via the standard
// YouTube Data API v3 — there is no separate YouTube Music API.
//
// Quota cost per operation (YouTube default: 10,000 units/day):
//   READ  (list)   →  1 unit
//   INSERT         → 50 units
//   DELETE         → 50 units
// Replacing a 100-track playlist costs ~10,000 units in deletes + inserts.
// Users with large playlists should be aware of this constraint.

// Scopes required for reading and writing YouTube playlists.
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Parses an ISO 8601 duration string (e.g. "PT3M27S") to milliseconds.
// YouTube returns video duration in this format — it is not a plain number.
const parseDurationMs = (duration: string): number => {
  const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h   = parseInt(m[1] ?? '0', 10);
  const min = parseInt(m[2] ?? '0', 10);
  const sec = parseInt(m[3] ?? '0', 10);
  return (h * 3600 + min * 60 + sec) * 1000;
};

// Chooses the best available thumbnail URL from a YouTube thumbnails object.
// Prefers high > medium > default to get the largest image available.
const pickThumbnail = (thumbnails: Record<string, { url: string }> | undefined): string | null => {
  if (!thumbnails) return null;
  return thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
};

// Removes the " - Topic" suffix that YouTube appends to auto-generated artist channels.
// Example: "Radiohead - Topic" → "Radiohead". Official Artist Channels and user-uploaded
// videos are unaffected since their titles don't carry this suffix.
const stripTopicSuffix = (channelTitle: string): string =>
  channelTitle.endsWith(' - Topic') ? channelTitle.slice(0, -' - Topic'.length) : channelTitle;

// Common suffixes appended to YouTube music video titles that are not part of the song name.
// Stripped from the title before extracting an artist name.
const TITLE_NOISE = /\s*[\[(](?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer)?|lyrics?|hd|hq|explicit|remaster(?:ed)?|live|audio)[^\])]*[\])]|\s*ft\.?.*$/gi;

// Tries to extract an artist name from a YouTube video title using the common
// "Artist - Song Title" convention. Returns null if the pattern is not found or
// the candidate looks like a generic description rather than an artist name.
//
// This is a best-effort heuristic for user-uploaded videos where the channel name
// is the uploader (e.g. "OldSchoolGangster100") rather than the artist. It will
// not always be correct — callers should treat the result as a fallback only.
const parseArtistFromTitle = (title: string): string | null => {
  // Require a clear " - " separator — without it there is no reliable split point.
  const sepIdx = title.indexOf(' - ');
  if (sepIdx === -1) return null;

  const candidate = title.slice(0, sepIdx).replace(TITLE_NOISE, '').trim();

  // Reject candidates that are empty, suspiciously long (likely a song title fragment),
  // or start with common non-artist words that suggest a generic title format.
  if (!candidate || candidate.length > 60) return null;
  if (/^(best|top|mix|playlist|compilation|collection|greatest|hits|live|album)/i.test(candidate)) return null;

  return candidate;
};

// Returns true if the video belongs to YouTube's Music category (categoryId 10).
// Used to filter liked-videos so non-music content (gaming, vlogs, etc.) is excluded.
const isMusicVideo = (video: any): boolean =>
  video.snippet?.categoryId === '10';

// Resolves the best available artist name for a YouTube video.
//
// Priority:
//   1. Topic channel  — strip " - Topic" from channelTitle (official release, reliable)
//   2. Title parse    — extract left-hand side of "Artist - Song" from video title (best-effort)
//   3. Channel title  — fall back to the raw uploader channel name
const resolveArtist = (channelTitle: string, videoTitle: string): string => {
  const stripped = stripTopicSuffix(channelTitle);
  if (stripped !== channelTitle) return stripped;          // was a Topic channel
  return parseArtistFromTitle(videoTitle) ?? channelTitle; // title parse or raw fallback
};

// Converts raw video + audio-features data into a normalized PlatformTrack.
// ytm carries artist and album from the Innertube browse (available for public playlists).
// Falls back to resolveArtist() for private playlists where Innertube returns nothing.
const buildTrack = (
  video: any,
  audioFeaturesMap: Record<string, any>,
  artistGenreMap: Record<string, string[]>,
  ytm?: { artist: string | null; album: string | null }
): PlatformTrack => {
  const features      = audioFeaturesMap[video.id] || {};
  const channelId     = video.snippet?.channelId ?? '';
  const channelTitle  = video.snippet?.channelTitle ?? '';
  const videoTitle    = video.snippet?.title ?? '';
  const genres        = artistGenreMap[channelId] || [];

  return {
    id:           video.id,
    name:         videoTitle,
    artist:       ytm?.artist ?? resolveArtist(channelTitle, videoTitle),
    albumName:    ytm?.album  ?? '',
    albumImageUrl: pickThumbnail(video.snippet?.thumbnails),
    durationMs:   parseDurationMs(video.contentDetails?.duration ?? ''),
    releaseYear:  video.snippet?.publishedAt
      ? new Date(video.snippet.publishedAt).getFullYear()
      : null,
    genres,
    audioFeatures: {
      energy:           features.energy           ?? null,
      danceability:     features.danceability     ?? null,
      valence:          features.valence          ?? null,
      acousticness:     features.acousticness     ?? null,
      instrumentalness: features.instrumentalness ?? null,
      speechiness:      features.speechiness      ?? null,
      tempo:            features.tempo            ?? null,
    },
  };
};

// Fetches full video objects for a list of video IDs in batches of 50.
// YouTube's videos.list endpoint accepts up to 50 IDs per request.
// Returns a Map<videoId, videoObject> for quick lookup when building tracks.
const fetchVideoBatch = async (
  accessToken: string,
  videoIds: string[]
): Promise<Map<string, any>> => {
  const map = new Map<string, any>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const chunk = videoIds.slice(i, i + BATCH_SIZE);
    const response = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/videos`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          part:       'snippet,contentDetails',
          id:         chunk.join(','),
          maxResults: BATCH_SIZE,
        },
      },
      undefined,
      3,
      'YouTube'
    );
    for (const video of response.data.items ?? []) {
      map.set(video.id, video);
    }
  }

  return map;
};

// Fetches all playlistItem IDs (not video IDs) currently in a playlist.
// These item IDs are required by the DELETE endpoint — the video ID alone is not enough
// because the same video can appear multiple times under different item IDs.
const fetchAllPlaylistItemIds = async (
  accessToken: string,
  playlistId: string
): Promise<string[]> => {
  const itemIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/playlistItems`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          part:       'id',
          playlistId,
          maxResults: 50,
          ...(pageToken ? { pageToken } : {}),
        },
      },
      undefined,
      3,
      'YouTube'
    );
    for (const item of response.data.items ?? []) {
      itemIds.push(item.id);
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return itemIds;
};

// ─── YouTubeAdapter ───────────────────────────────────────────────────────────

// Implements PlatformAdapter for YouTube / YouTube Music.
// YouTube Music playlists are standard YouTube playlists — there is no separate
// YouTube Music API. This adapter targets the YouTube Data API v3.
//
// Key differences from Spotify/SoundCloud:
//   - No ISRC in API responses → audio features rely on MusicBrainz title+artist lookup
//   - Cursor-based pagination (nextPageToken) — bridged to the page-number model via
//     an in-memory cache, the same pattern used by TidalAdapter
//   - No atomic playlist replace endpoint — deletes then re-inserts each track
//   - "Artist" is approximated by channelTitle (the uploading channel name)
//   - Daily write quota (10,000 units) limits how many replace operations are feasible
export class YouTubeAdapter implements PlatformAdapter {
  readonly platform            = 'YOUTUBE' as const;
  readonly trackCacheIdField   = 'youtubeId';
  readonly artistCacheIdField  = 'youtubeArtistId';

  // Bridges YouTube's cursor-based pagination to the client's page-number model.
  // When page N is fetched the response's nextPageToken is stored here under the key
  // `playlistId:(N+1)` so the subsequent request can resume without re-fetching from page 0.
  // Entries expire after 10 minutes — enough for any realistic playlist load session.
  private pageTokenCache = new Map<string, { token: string; expiresAt: number }>();

  // Caches the liked-videos playlist ID per access token.
  // Retrieving it requires a separate channels.list call — caching avoids repeating it
  // on every fetchLikedTracks / fetchLikedCount call within the same session.
  private likedPlaylistIdCache = new Map<string, { id: string; expiresAt: number }>();

  // Innertube API config scraped from the YouTube Music homepage.
  // Refreshed after 24 hours since clientVersion changes with YouTube deployments.
  private innertubeConfig: {
    apiKey: string; clientVersion: string; visitorData: string; expiresAt: number;
  } | null = null;

  // Per-playlist Innertube metadata: artist and album names keyed by videoId.
  // Populated once on the first page load and reused for subsequent pages.
  private ytmusicMetaCache = new Map<string, Map<string, { artist: string | null; album: string | null }>>();

  // ─── Innertube enrichment helpers ───────────────────────────────────────────

  // Extracts a single string field from YouTube's embedded JS config blocks.
  private extractConfigField(html: string, key: string): string | null {
    const match = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return match ? match[1] : null;
  }

  // Fetches and caches the Innertube API config from the YouTube Music homepage.
  private async ensureInnertubeConfig(): Promise<{ apiKey: string; clientVersion: string; visitorData: string }> {
    if (this.innertubeConfig && Date.now() < this.innertubeConfig.expiresAt) {
      return this.innertubeConfig;
    }
    const res = await axios.get<string>(MUSIC_URL, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html          = res.data;
    const apiKey        = this.extractConfigField(html, 'INNERTUBE_API_KEY');
    const clientVersion = this.extractConfigField(html, 'INNERTUBE_CLIENT_VERSION');
    const visitorData   = this.extractConfigField(html, 'VISITOR_DATA') ?? '';
    if (!apiKey || !clientVersion) throw new Error('Innertube config extraction failed');
    this.innertubeConfig = { apiKey, clientVersion, visitorData, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    return this.innertubeConfig;
  }

  // Returns the WEB_REMIX client context block required by every Innertube request.
  // visitorData is omitted deliberately: it comes from an anonymous page scrape and
  // including it in authenticated requests causes Google to reject them with 400.
  private innertubeContext(clientVersion: string, _visitorData: string): object {
    return {
      client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US' },
      user:   { lockedSafetyMode: false },
    };
  }

  // Reads the pageType from an Innertube run's browse endpoint config.
  // Identifies what a flex column represents: artist, album, etc.
  private runPageType(run: any): string | null {
    return run?.navigationEndpoint?.browseEndpoint
      ?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig
      ?.pageType ?? null;
  }

  // Extracts artist and album names from an Innertube musicResponsiveListItemRenderer.
  // Each flex column's runs are tagged with a pageType that identifies the content type.
  private parseRendererMeta(renderer: any): { artist: string | null; album: string | null } {
    let artist: string | null = null;
    let album:  string | null = null;
    for (const col of (renderer.flexColumns ?? [])) {
      for (const run of (col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])) {
        const type = this.runPageType(run);
        if (type === 'MUSIC_PAGE_TYPE_ARTIST' && !artist) artist = run.text ?? null;
        if (type === 'MUSIC_PAGE_TYPE_ALBUM'  && !album)  album  = run.text ?? null;
      }
    }
    return { artist, album };
  }

  // Extracts the videoId from an Innertube musicResponsiveListItemRenderer.
  private rendererVideoId(renderer: any): string | null {
    return renderer.playlistItemData?.videoId
      ?? renderer.overlay?.musicItemThumbnailOverlayRenderer
         ?.content?.musicPlayButtonRenderer
         ?.playNavigationEndpoint?.watchEndpoint?.videoId
      ?? null;
  }

  // Recursively collects all musicResponsiveListItemRenderer objects from a response.
  // Depth-limited to avoid runaway traversal on unexpectedly nested responses.
  private collectRenderers(obj: any, depth = 0): any[] {
    if (!obj || typeof obj !== 'object' || depth > 15) return [];
    if (obj.musicResponsiveListItemRenderer) return [obj.musicResponsiveListItemRenderer];
    return Object.values(obj).flatMap((v: any) => this.collectRenderers(v, depth + 1));
  }

  // Finds the first Innertube continuation token in a response object.
  private findContinuation(obj: any, depth = 0): string | null {
    if (!obj || typeof obj !== 'object' || depth > 15) return null;
    if (typeof obj.continuation === 'string' && obj.continuation.length > 20) return obj.continuation;
    for (const v of Object.values(obj)) {
      const token = this.findContinuation(v, depth + 1);
      if (token) return token;
    }
    return null;
  }

  // Fetches YouTube Music metadata (artist, album) for all tracks in a public playlist
  // by browsing the Innertube endpoint anonymously. Returns an empty map for private
  // playlists or on any error — callers fall back to resolveArtist() transparently.
  private async fetchYtmusicMeta(
    playlistId: string
  ): Promise<Map<string, { artist: string | null; album: string | null }>> {
    const meta = new Map<string, { artist: string | null; album: string | null }>();

    let cfg: { apiKey: string; clientVersion: string; visitorData: string };
    try {
      cfg = await this.ensureInnertubeConfig();
    } catch {
      return meta;
    }

    const url     = `${MUSIC_URL}/youtubei/v1/browse?key=${cfg.apiKey}&prettyPrint=false`;
    const headers = { 'Content-Type': 'application/json', 'Origin': MUSIC_URL };
    const ctx     = this.innertubeContext(cfg.clientVersion, cfg.visitorData);

    let body: object = { context: ctx, browseId: `VL${playlistId}` };
    const MAX_PAGES = 20; // safety cap — 20 pages × ~100 items covers 2 000-track playlists

    for (let page = 0; page < MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await axios.post(url, body, { headers });
        data = res.data;
      } catch {
        break; // 400 for private playlists, network errors — stop silently
      }

      for (const renderer of this.collectRenderers(data)) {
        const videoId = this.rendererVideoId(renderer);
        if (videoId) meta.set(videoId, this.parseRendererMeta(renderer));
      }

      const continuation = this.findContinuation(data);
      if (!continuation) break;

      // Continuation requests send the token in the body alongside the context
      body = { context: ctx, continuation };
    }

    return meta;
  }

  private pageTokenKey = (playlistId: string, page: number): string =>
    `${playlistId}:${page}`;

  // Looks up a stored page token. Returns undefined if expired or not found.
  private getPageToken(playlistId: string, page: number): string | undefined {
    const entry = this.pageTokenCache.get(this.pageTokenKey(playlistId, page));
    if (!entry || Date.now() > entry.expiresAt) return undefined;
    return entry.token;
  }

  // Stores a page token for the given (playlistId, page) pair with a 10-minute TTL.
  private setPageToken(playlistId: string, page: number, token: string): void {
    this.pageTokenCache.set(this.pageTokenKey(playlistId, page), {
      token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  // Fetches the liked-videos playlist ID from the user's channel, with caching.
  // The ID is stored in channel.contentDetails.relatedPlaylists.likes.
  private async fetchLikedPlaylistId(accessToken: string): Promise<string | null> {
    const cached = this.likedPlaylistIdCache.get(accessToken);
    if (cached && Date.now() < cached.expiresAt) return cached.id;

    const response = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/channels`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { part: 'contentDetails', mine: true },
      },
      undefined,
      3,
      'YouTube'
    );

    const id = response.data.items?.[0]?.contentDetails?.relatedPlaylists?.likes ?? null;
    if (id) {
      this.likedPlaylistIdCache.set(accessToken, {
        id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
    }
    return id;
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  // Returns the Google OAuth 2.0 authorization URL.
  // `access_type=offline` requests a refresh token so sessions survive token expiry.
  // `prompt=consent` forces the consent screen to always appear — without it, Google
  // only returns a refresh token on the very first authorization for that client.
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id:     process.env.YOUTUBE_CLIENT_ID!,
      redirect_uri:  `${process.env.SERVER_URL}/auth/youtube/callback`,
      response_type: 'code',
      scope:         YOUTUBE_SCOPES,
      access_type:   'offline',
      prompt:        'consent',
    });

    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  // Exchanges a one-time authorization code for access + refresh tokens.
  // Fetches the user's Google profile for display name and email.
  // The YouTube channel ID (not Google account ID) is used as platformUserId so that
  // users who connect multiple YouTube accounts stay separate in the database.
  async exchangeCode(code: string): Promise<AuthResult> {
    const tokenResponse = await requestWithRetry(
      'post',
      GOOGLE_TOKEN_URL,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  `${process.env.SERVER_URL}/auth/youtube/callback`,
        client_id:     process.env.YOUTUBE_CLIENT_ID!,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      }),
      3,
      'YouTube auth'
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Fetch the Google account profile for display name and email.
    const profileResponse = await requestWithRetry(
      'get',
      USERINFO_URL,
      { headers: { Authorization: `Bearer ${access_token}` } },
      undefined,
      3,
      'YouTube'
    );

    // Fetch the YouTube channel to get the channel ID used as platformUserId.
    // Using the channel ID (rather than the Google account ID) means a user can
    // have separate Tunecraft accounts for different YouTube brand accounts.
    const channelResponse = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/channels`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { part: 'snippet', mine: true },
      },
      undefined,
      3,
      'YouTube'
    );

    const { email, name } = profileResponse.data;
    const channelId       = channelResponse.data.items?.[0]?.id ?? profileResponse.data.id;
    const displayName     = channelResponse.data.items?.[0]?.snippet?.title ?? name;

    return {
      accessToken:    access_token,
      refreshToken:   refresh_token,
      expiresAt:      new Date(Date.now() + expires_in * 1000),
      platformUserId: channelId,
      displayName:    displayName ?? name,
      email:          email ?? null,
    };
  }

  // Refreshes an expired access token using the stored refresh token.
  async refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
    const response = await requestWithRetry(
      'post',
      GOOGLE_TOKEN_URL,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.YOUTUBE_CLIENT_ID!,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      }),
      3,
      'YouTube auth'
    );

    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expiresAt:   new Date(Date.now() + expires_in * 1000),
    };
  }

  // ─── Read ─────────────────────────────────────────────────────────────────────

  // Collects all musicTwoRowItemRenderer objects from an Innertube response.
  // Used when browsing playlist grids (library, search results) rather than track lists.
  private collectTwoRowRenderers(obj: any, depth = 0): any[] {
    if (!obj || typeof obj !== 'object' || depth > 15) return [];
    if (obj.musicTwoRowItemRenderer) return [obj.musicTwoRowItemRenderer];
    return Object.values(obj).flatMap((v: any) => this.collectTwoRowRenderers(v, depth + 1));
  }

  // Extracts a PlatformPlaylist from an Innertube musicTwoRowItemRenderer.
  // Only accepts regular playlists (IDs starting with "PL") — auto-playlists like
  // Liked Songs ("LL") and YouTube Mixes ("RDMM", "RDAMVM", etc.) are skipped.
  private parseTwoRowPlaylist(renderer: any): PlatformPlaylist | null {
    const browseId = renderer.navigationEndpoint?.browseEndpoint?.browseId as string | undefined;
    if (!browseId?.startsWith('VL')) return null;
    const id = browseId.slice(2); // strip 'VL' prefix
    if (!id.startsWith('PL')) return null; // skip Liked Songs, Mixes, etc.

    const name = renderer.title?.runs?.[0]?.text as string | undefined;
    if (!name) return null;

    // Subtitle runs may include "42 songs" — extract that as the track count.
    let trackCount = 0;
    for (const run of (renderer.subtitle?.runs ?? [])) {
      const m = (run.text as string | undefined)?.match(/^(\d+)\s+song/);
      if (m) { trackCount = parseInt(m[1], 10); break; }
    }

    // Pick the largest available thumbnail (Innertube returns them smallest-first).
    const thumbs = renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails as any[] | undefined;
    const imageUrl = thumbs?.[thumbs.length - 1]?.url ?? null;

    return { id, name, imageUrl, ownerId: '', trackCount };
  }

  // Stub — returns empty. The Innertube browse endpoints that expose the full YTM
  // library (including saved/followed playlists) require cookie-based session auth
  // (SAPISID), which is incompatible with our OAuth Bearer token model. The YouTube
  // Data API v3 (mine=true) exposes only user-owned playlists and has no endpoint
  // for playlists saved from other channels. This is a confirmed YouTube API limitation.
  // If Google ever exposes this via the official API, implement it here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async fetchLibraryPlaylists(_accessToken: string): Promise<PlatformPlaylist[]> {
    return [];
  }

  // Fetches playlists the user owns via the Data API (authoritative track counts).
  // YouTube returns playlists in pages of up to 50 — we loop until all are loaded.
  private async fetchOwnedPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const playlists: PlatformPlaylist[] = [];
    let pageToken: string | undefined;

    do {
      const response = await requestWithRetry(
        'get',
        `${YOUTUBE_API}/playlists`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            part:       'snippet,contentDetails',
            mine:       true,
            maxResults: 50,
            ...(pageToken ? { pageToken } : {}),
          },
        },
        undefined,
        3,
        'YouTube'
      );

      for (const p of response.data.items ?? []) {
        playlists.push({
          id:         p.id,
          name:       p.snippet?.title ?? '',
          imageUrl:   pickThumbnail(p.snippet?.thumbnails),
          ownerId:    p.snippet?.channelId ?? '',
          trackCount: p.contentDetails?.itemCount ?? 0,
        });
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return playlists;
  }

  // Fetches all playlists in the user's YouTube Music library: both playlists they
  // created (Data API) and playlists they follow/saved from others (Innertube).
  // The Data API results are preferred when a playlist appears in both sources
  // because they carry authoritative track counts.
  async fetchPlaylists(accessToken: string): Promise<PlatformPlaylist[]> {
    const [owned, library] = await Promise.all([
      this.fetchOwnedPlaylists(accessToken),
      this.fetchLibraryPlaylists(accessToken),
    ]);

    // Owned playlists take precedence (better track counts); library adds any extras.
    const seen  = new Set(owned.map(p => p.id));
    const saved = library.filter(p => !seen.has(p.id));

    return [...owned, ...saved];
  }

  // Fetches metadata for a single YouTube playlist by its ID.
  async fetchPlaylist(accessToken: string, playlistId: string): Promise<PlatformPlaylist> {
    const response = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/playlists`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { part: 'snippet,contentDetails', id: playlistId },
      },
      undefined,
      3,
      'YouTube'
    );

    const p = response.data.items?.[0];
    if (!p) throw new Error(`YouTube playlist not found: ${playlistId}`);

    return {
      id:         p.id,
      name:       p.snippet?.title ?? '',
      imageUrl:   pickThumbnail(p.snippet?.thumbnails),
      ownerId:    p.snippet?.channelId ?? '',
      trackCount: p.contentDetails?.itemCount ?? 0,
    };
  }

  // Fetches one page of enriched tracks from a YouTube playlist.
  // YouTube's pagination is cursor-based (nextPageToken), not offset-based.
  // The cursor for page N+1 is cached after fetching page N so sequential page loads
  // can resume without re-fetching earlier pages.
  async fetchPlaylistTracks(
    accessToken: string,
    playlistId: string,
    page: number,
    signal?: AbortSignal,
    // Optional post-fetch filter applied to raw video objects before building tracks.
    // Allows callers to narrow results (e.g. music-only) without a separate API pass.
    videoFilter?: (video: any) => boolean
  ): Promise<{ tracks: PlatformTrack[]; total: number; hasMore?: boolean }> {
    const pageToken = page === 0 ? undefined : this.getPageToken(playlistId, page);

    // If the cursor for this page was not cached (e.g. server restarted or session expired),
    // returning an empty result is safer than re-fetching from page 0, which would show
    // duplicate tracks in the UI.
    if (page > 0 && !pageToken) {
      return { tracks: [], total: 0, hasMore: false };
    }

    const itemsResponse = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/playlistItems`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          part:       'snippet,contentDetails',
          playlistId,
          maxResults: 50,
          ...(pageToken ? { pageToken } : {}),
        },
      },
      undefined,
      3,
      'YouTube',
      signal
    );

    const nextPageToken: string | undefined = itemsResponse.data.nextPageToken;
    if (nextPageToken) {
      this.setPageToken(playlistId, page + 1, nextPageToken);
    }

    const total: number = itemsResponse.data.pageInfo?.totalResults ?? 0;

    // Filter out deleted or private videos — they appear with no videoId or title.
    const items = (itemsResponse.data.items ?? []).filter(
      (item: any) => item.contentDetails?.videoId
    );
    const videoIds: string[] = items.map((item: any) => item.contentDetails.videoId);

    if (videoIds.length === 0) {
      return { tracks: [], total, hasMore: !!nextPageToken };
    }

    // Fetch YouTube Music metadata (artist, album) via anonymous Innertube browse on page 0.
    // Cached for subsequent pages — one network call per playlist per server session.
    // Silently skipped for private playlists; resolveArtist() handles those as fallback.
    if (page === 0 && !this.ytmusicMetaCache.has(playlistId)) {
      const ytmMeta = await this.fetchYtmusicMeta(playlistId);
      this.ytmusicMetaCache.set(playlistId, ytmMeta);
    }
    const ytmusicMeta = this.ytmusicMetaCache.get(playlistId);

    // Fetch full video metadata (title, channel, duration, thumbnail) in one batch call.
    const videoMap = await fetchVideoBatch(accessToken, videoIds);

    // Apply the optional video filter (e.g. music-only for liked tracks).
    // Filtering here, after fetchVideoBatch, lets us inspect fields like categoryId
    // that are only available on the full video object, not on playlistItem.
    const filteredVideoIds = videoFilter
      ? videoIds.filter(id => { const v = videoMap.get(id); return v && videoFilter(v); })
      : videoIds;

    // Build enrichment input — YouTube doesn't provide ISRC, so spotifyId starts as null.
    // Audio features will only be populated if MusicBrainz can resolve a Spotify ID from
    // the title + artist name via the isrcLookup pipeline.
    const enrichmentInput: EnrichmentTrack[] = filteredVideoIds
      .map(id => videoMap.get(id))
      .filter(Boolean)
      .map((video: any) => ({
        platformId: video.id,
        spotifyId:  null,
        idField:    this.trackCacheIdField,
        artistId:   video.snippet?.channelId ?? video.id,
        artistName: resolveArtist(video.snippet?.channelTitle ?? '', video.snippet?.title ?? ''),
        isrc:       undefined,
        platform:   'YOUTUBE' as const,
      }));

    const { audioFeaturesMap, artistGenreMap } = await fetchEnrichmentMaps(enrichmentInput);

    const tracks = filteredVideoIds
      .map(id => videoMap.get(id))
      .filter(Boolean)
      .map((video: any) => buildTrack(video, audioFeaturesMap, artistGenreMap, ytmusicMeta?.get(video.id)));

    return { tracks, total, hasMore: !!nextPageToken };
  }

  // Fetches every video ID in the user's YouTube Music library via Innertube.
  // Uses the FEmusic_liked_videos browse ID, which returns music-only library songs
  // (not the liked-videos playlist — despite the name, it excludes non-music content).
  // All pages are fetched upfront and the result is cached for 5 minutes so that
  // subsequent page requests (fetchLikedTracks page 1, 2, …) are served from cache.
  // Returns the total number of tracks in the user's liked-videos playlist.
  async fetchLikedCount(accessToken: string): Promise<number> {
    const likedId = await this.fetchLikedPlaylistId(accessToken);
    if (!likedId) return 0;

    const response = await requestWithRetry(
      'get',
      `${YOUTUBE_API}/playlistItems`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { part: 'id', playlistId: likedId, maxResults: 1 },
      },
      undefined,
      3,
      'YouTube'
    );

    return response.data.pageInfo?.totalResults ?? 0;
  }

  // Fetches one page of enriched tracks from the user's liked-videos playlist.
  // The liked-videos playlist includes all video types (gaming, vlogs, etc.) — filtering
  // to categoryId 10 keeps only videos YouTube has categorised as Music.
  // Note: `total` reflects the full liked-videos count, not the music-only count,
  // since the playlist total is known before video details (and categoryId) are fetched.
  //
  // A cleaner approach via Innertube FEmusic_liked_videos was investigated but confirmed
  // to require cookie-based session auth — it returns 400 with OAuth Bearer tokens.
  async fetchLikedTracks(
    accessToken: string,
    page: number
  ): Promise<{ tracks: PlatformTrack[]; total: number; hasMore?: boolean }> {
    const likedId = await this.fetchLikedPlaylistId(accessToken);
    if (!likedId) return { tracks: [], total: 0, hasMore: false };
    return this.fetchPlaylistTracks(accessToken, likedId, page, undefined, isMusicVideo);
  }

  // Fetches every track across all pages without audio-feature enrichment.
  // Used exclusively by the auto-reshuffle cron — avoids the overhead of ReccoBeats calls.
  async fetchAllTracksMeta(
    accessToken: string,
    playlistId: string
  ): Promise<PlatformTrackMeta[]> {
    const tracks: PlatformTrackMeta[] = [];
    let pageToken: string | undefined;

    do {
      const itemsResponse = await requestWithRetry(
        'get',
        `${YOUTUBE_API}/playlistItems`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            part:       'contentDetails',
            playlistId,
            maxResults: 50,
            ...(pageToken ? { pageToken } : {}),
          },
        },
        undefined,
        3,
        'YouTube'
      );

      const videoIds: string[] = (itemsResponse.data.items ?? [])
        .map((item: any) => item.contentDetails?.videoId)
        .filter(Boolean);

      if (videoIds.length > 0) {
        const videoMap = await fetchVideoBatch(accessToken, videoIds);
        for (const id of videoIds) {
          const video = videoMap.get(id);
          if (!video) continue;
          tracks.push({
            id,
            artist:      video.snippet?.channelTitle ?? '',
            genres:      [],
            releaseYear: video.snippet?.publishedAt
              ? new Date(video.snippet.publishedAt).getFullYear()
              : null,
          });
        }
      }

      pageToken = itemsResponse.data.nextPageToken;
    } while (pageToken);

    return tracks;
  }

  // ─── Write ────────────────────────────────────────────────────────────────────

  // Creates a new public YouTube playlist and returns its ID and owning channel ID.
  async createPlaylist(
    accessToken: string,
    name: string,
    description: string
  ): Promise<{ id: string; ownerId: string }> {
    const response = await requestWithRetry(
      'post',
      `${YOUTUBE_API}/playlists`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        params:  { part: 'snippet,status' },
      },
      {
        snippet: { title: name, description },
        status:  { privacyStatus: 'public' },
      },
      3,
      'YouTube'
    );

    return {
      id:      response.data.id,
      ownerId: response.data.snippet?.channelId ?? '',
    };
  }

  // Replaces the entire content of a YouTube playlist with a new ordered track list.
  //
  // YouTube has no atomic "replace all" endpoint, so this performs three phases:
  //   1. Fetch all current playlistItem IDs (read, cheap)
  //   2. DELETE each playlistItem (50 quota units each)
  //   3. POST each new video in the desired order (50 quota units each)
  //
  // Quota warning: a 100-track playlist costs ~10,000 units in phase 2+3 combined,
  // which equals YouTube's entire default daily quota. This is a hard API limitation.
  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    // Phase 1 — collect existing playlistItem IDs before modifying anything.
    const existingItemIds = await fetchAllPlaylistItemIds(accessToken, playlistId);

    // Phase 2 — remove every existing item. Sequential to respect YouTube's rate limits.
    for (const itemId of existingItemIds) {
      await requestWithRetry(
        'delete',
        `${YOUTUBE_API}/playlistItems`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { id: itemId },
        },
        undefined,
        3,
        'YouTube'
      );
    }

    // Phase 3 — insert each new track in the requested order.
    // Each insert sets `position` so YouTube respects the intended order.
    // 409 ABORTED is a transient backend conflict that YouTube recommends retrying —
    // pass it as an extra retry code so requestWithRetry handles it automatically.
    // A 200ms pause between inserts prevents rapid-fire requests from sustaining 409s
    // on YouTube's backend, which appears to rate-limit write operations below HTTP 429.
    const INSERT_PAUSE_MS = 200;
    for (let i = 0; i < trackIds.length; i++) {
      await requestWithRetry(
        'post',
        `${YOUTUBE_API}/playlistItems`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          params:  { part: 'snippet' },
        },
        {
          snippet: {
            playlistId,
            position:   i,
            resourceId: { kind: 'youtube#video', videoId: trackIds[i] },
          },
        },
        3,
        'YouTube',
        undefined,
        [409]
      );
      if (i < trackIds.length - 1) await new Promise(r => setTimeout(r, INSERT_PAUSE_MS));
    }
  }

  // Appends tracks to an existing YouTube playlist without replacing existing content.
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackIds: string[]
  ): Promise<void> {
    for (const videoId of trackIds) {
      await requestWithRetry(
        'post',
        `${YOUTUBE_API}/playlistItems`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          params:  { part: 'snippet' },
        },
        {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
        3,
        'YouTube'
      );
    }
  }

  // YouTube write endpoints take the raw video ID directly (no URI wrapping needed).
  formatTrackUri(trackId: string): string {
    return trackId;
  }

  // Checks whether a playlist is still in the user's library.
  // Fetches the playlist directly — if YouTube returns a 404, it no longer exists.
  // Returns true on any network or non-404 error so the cron never deletes on uncertainty.
  async playlistInLibrary(accessToken: string, playlistId: string): Promise<boolean> {
    try {
      const response = await requestWithRetry(
        'get',
        `${YOUTUBE_API}/playlists`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params:  { part: 'id', id: playlistId },
        },
        undefined,
        3,
        'YouTube'
      );
      return (response.data.items?.length ?? 0) > 0;
    } catch {
      return true; // network/5xx — assume it still exists
    }
  }

  // Accepts a YouTube or YouTube Music playlist URL, or a raw playlist ID.
  // YouTube playlist IDs start with "PL" and are 34 characters long.
  // YouTube Music URLs use the same `list=` query parameter as youtube.com.
  extractPlaylistId(input: string): string | null {
    const trimmed = input.trim();

    // Extract `list=` from any YouTube or YouTube Music URL.
    const urlMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];

    // Accept a bare playlist ID (starts with "PL", 34 alphanumeric chars).
    if (/^PL[a-zA-Z0-9_-]{32}$/.test(trimmed)) return trimmed;

    return null;
  }
}
