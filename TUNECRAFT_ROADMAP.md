# Tunecraft — Feature Roadmap

## Core Philosophy
Give users smarter, more powerful control over their streaming playlists than any single platform offers natively.

---

## Phase 1 — Foundation ✅ COMPLETE
- [x] Spotify OAuth login
- [x] Token exchange and storage
- [x] Token auto-refresh middleware
- [x] Fetch user's playlists
- [x] Display playlists in UI (dashboard)
- [x] Fetch playlist tracks with full data pipeline:
  - [x] Track metadata (Spotify API)
  - [x] Audio features — energy, danceability, valence, tempo etc. (ReccoBeats API)
  - [x] Artist genres (Last.fm API)

---

## Phase 2 — Playlist Detail Page ✅ COMPLETE
- [x] Pass platformUserId to frontend after login (needed for ownership checks)
- [x] Liked Songs special card on dashboard (uses /me/tracks endpoint)
- [x] Ownership indicator on playlist cards (yours vs following)
- [x] Frontend API function for tracks
- [x] Donut charts for audio features (collapsible section)
- [x] Track list with album art, artist, duration, BPM, genres
- [x] [Save] button for owned playlists
- [x] [Save as Copy] button with rename modal before saving
- [x] Shuffle button with multi-algorithm selection modal
- [x] Paginated track loading with background auto-fetch (progressive, per-page renders)
- [x] Database caching for tracks (TrackCache) and artists (ArtistCache)
- [x] Unsaved changes banner with Undo
- [x] Friendly error handling for inaccessible playlists

---

## Phase 3 — Playlist Discovery ✅ COMPLETE
- [x] Paste Spotify playlist URL or ID to open any public playlist
- [x] Dashboard split into Your Library and Following sections
- [ ] Browse by genre or mood (uses Spotify's browse/categories endpoints)
- [ ] Search Spotify's catalog (future consideration)

---

## Phase 4 — Smart Shuffle ✅ COMPLETE
- [x] True Random — Fisher-Yates equal-probability shuffle
- [x] Artist Spread — no two songs by the same artist back to back
- [x] Genre Spread — groups similar genres together for smoother flow
- [x] Chronological Mix — interleaves tracks from different eras
- [x] Algorithms are composable — genre + artist spread can be combined
- [x] Shuffle is frontend-only; Save/Copy writes the result to Spotify
- [x] Auto-Reshuffle — toggle per playlist, set interval (daily/weekly/monthly)
- [x] Last reshuffled timestamp tracked in DB
- [x] Background cron job (node-cron, runs hourly) executes server-side shuffle
- [x] Orphaned schedules cleaned up automatically on Spotify 404

---

## Phase 5 — Playlist Organizer ✅ COMPLETE
Advanced tools for merging, splitting, and reorganizing playlists — the power features Spotify doesn't offer.

### 5a — Merge Playlists ✅ COMPLETE
- [x] Multi-select playlists on the dashboard
- [x] Option to remove duplicates before saving
- [x] Save merged result as a new Spotify playlist

### 5b — Split a Playlist ✅ COMPLETE
- [x] Open any owned playlist and choose "Split"
- [x] Choose split strategy:
  - [x] By genre (uses existing genre data from Last.fm)
  - [x] By artist (one playlist per artist)
  - [x] By era/decade (uses releaseYear already on each track)
  - [x] By energy, danceability, valence, acousticness, instrumentalness, speechiness, tempo (low/medium/high buckets)
- [x] Preview the resulting sub-playlists before saving
- [x] Track-level actions in preview: remove, copy to group, transfer to group
- [x] Merge split groups together before saving
- [x] Inline group renaming before saving
- [x] Save each split group as a new Spotify playlist

### 5c — Duplicate Finder ✅ COMPLETE
- [x] Scan the currently loaded playlist for duplicate tracks
- [x] Show duplicates inline on the playlist detail page
- [x] Option to remove duplicates from the playlist

---

## Phase 6 — Multi-Platform Support ✅ ARCHITECTURE COMPLETE
The backend is fully platform-agnostic. Adding a new platform means implementing one interface.

### What's done
- [x] `PlatformAdapter` interface (`server/src/lib/platform/types.ts`) — defines all methods a platform must implement
- [x] `SpotifyAdapter` (`server/src/lib/platform/spotify.ts`) — full Spotify implementation
- [x] `SoundCloudAdapter` (`server/src/lib/platform/soundcloud.ts`) — full SoundCloud implementation (awaiting API credentials)
- [x] `TidalAdapter` (`server/src/lib/platform/tidal.ts`) — full Tidal implementation (PKCE OAuth 2.0)
- [x] `YouTubeAdapter` (`server/src/lib/platform/youtube.ts`) — YouTube Music via YouTube Data API v3 (testing in progress)
- [x] Registry (`server/src/lib/platform/registry.ts`) — singleton adapters, `getAdapter(platform)` lookup
- [x] All DB fields are platform-agnostic (`platformUserId`, `platformPlaylistId`)
- [x] All server routes use `getAdapter()` — no platform-specific code in routes
- [x] Client stores `platformUserId` in localStorage; all API calls use it
- [x] Login page has platform picker UI (Spotify active, SoundCloud/Apple Music disabled)
- [x] `platform` field included in all API responses so client knows which service each track belongs to
- [x] `TrackCache` redesigned for cross-platform deduplication:
  - One row per unique recording (not one per platform track entry)
  - `isrc` column links the same song across platforms
  - `spotifyId`, `soundcloudId`, and `tidalId` columns — add one column per new platform
  - ISRC cross-hit in `readEnrichmentCache` returns cached features immediately and backfills the new platform's ID fire-and-forget
  - ReccoBeats is never called twice for the same recording regardless of which platform surfaces it

### Audio features strategy — ISRC cross-reference
ReccoBeats only accepts Spotify track IDs. Most commercially released tracks carry an ISRC (International Standard Recording Code) — a universal identifier that follows a song across every platform.

**Flow for non-Spotify platforms:**
1. Get track → read its ISRC field
2. Check `TrackCache` by ISRC — if hit, return cached features immediately (no ReccoBeats call)
3. Cache miss → query MusicBrainz first (free, no auth, 1 req/sec) to resolve a Spotify ID from the ISRC
4. MusicBrainz miss → fall back to Spotify search: `GET /search?q=isrc:{code}&type=track`
5. Submit resolved Spotify ID to ReccoBeats; upsert result by ISRC so both platform IDs share the row
6. No ISRC or no Spotify match → track gets no audio features (graceful fallback)

### Tidal activation ✅ COMPLETE
- [x] Obtained Tidal developer credentials at [developer.tidal.com/dashboard](https://developer.tidal.com/dashboard)
- [x] Added `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`, `TIDAL_REDIRECT_URI` to `.env`
- [x] Registered redirect URI `http://127.0.0.1:3000/auth/tidal/callback` in the Tidal developer dashboard
- [x] Verified OAuth scopes: `user.read`, `collection.read`, `collection.write`, `playlists.read`, `playlists.write`

### What's needed to activate SoundCloud
- [ ] Obtain SoundCloud API credentials (client ID + secret)
- [ ] Add `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, `SOUNDCLOUD_REDIRECT_URI` to `.env`
- [ ] Enable the SoundCloud button in `Login.tsx`
- [ ] Register SoundCloud redirect URI in SoundCloud developer dashboard

### What's needed to add another platform (e.g. Deezer, Apple Music)
- [ ] Implement `PlatformAdapter` interface in `server/src/lib/platform/{platform}.ts`
- [ ] Register it in `registry.ts`
- [ ] Add OAuth flow in `routes/auth.ts`
- [ ] Add platform module to `client/src/utils/platform/` (see `spotify.ts` or `tidal.ts` as reference — implement track URL, label, badge style, and icon helpers)
- [ ] Add a `{platform}Id` column to `TrackCache` in `schema.prisma` + migration
- [ ] Enable the platform button in `Login.tsx`

---

## Phase 7 — Playlist Builder (Future)
Build new playlists intelligently based on what's already in the user's library.

### Genre-Based Builder
- [ ] Scan user's existing playlists
- [ ] Identify and group songs by genre
- [ ] Auto-generate new playlists from genre clusters
- [ ] Example: "Your Rock Mix", "Your Chill Vibes", "Your Workout Tracks"

### Weighted Shuffle
- [ ] Songs not heard recently get higher probability of appearing earlier in the shuffle
- [ ] Uses Spotify's `GET /me/player/recently-played` (returns up to 50 most recent plays with timestamps)
- [ ] Tracks absent from recent history are treated as "cold" and weighted up
- [ ] Basic version requires no DB changes — works within Spotify's 50-track window
- [ ] Enhanced version: add a `PlayHistory` table to track plays over time beyond Spotify's limit

---

## Future Ideas (Backlog)
- Mood detection based on audio features (energy, valence, tempo per track)
- Collaborative playlist building with friends
- Playlist history and version control ("restore my playlist from last week")
- Listening stats and insights
- Manual genre tagging by users for artists not covered by Last.fm

---

## API Architecture
```
GET  /playlists/:userId                          → user's playlists (dashboard)
GET  /playlists/:userId/liked                    → liked songs count
GET  /playlists/:userId/liked/tracks             → liked songs tracks (paginated)
GET  /playlists/:userId/discover/:playlistId     → any public playlist metadata
GET  /playlists/:userId/features?ids=...         → cached audio features for track IDs (poll endpoint)
GET  /playlists/:userId/:playlistId/tracks       → playlist tracks (paginated)
POST /playlists/:userId/:playlistId/shuffle      → write shuffled order to platform
POST /playlists/:userId/copy                     → create a named copy in user's account
PUT  /playlists/:userId/:playlistId/save         → save track order (owned only)
POST /playlists/:userId/merge                    → merge multiple playlists into one new playlist
POST /playlists/:userId/:playlistId/split        → split one playlist into multiple by strategy

GET  /reshuffle/:userId                          → all active auto-reshuffle schedules for user
POST /reshuffle/:userId/:playlistId              → enable/update auto-reshuffle schedule
DELETE /reshuffle/:userId/:playlistId            → remove auto-reshuffle schedule
```

## Ownership Logic
```
playlist.ownerId === platformUserId → show [Save] + [Save as Copy]
playlist.ownerId !== platformUserId → show [Save as Copy] only
playlistId === 'liked'              → show [Save as Copy] only (not a real playlist)
```

## Technical Notes
- **Platform adapter pattern**: implement `PlatformAdapter` interface + register in `registry.ts` to add a new platform; add a `{platform}Id` column to `TrackCache`
- All DB fields are platform-agnostic: `platformUserId`, `platformPlaylistId`
- `TrackCache` uses one row per unique recording — keyed by ISRC, with per-platform ID columns (`spotifyId`, `soundcloudId`, `tidalId`)
- Auto-reshuffle uses `node-cron` (hourly); server-side shuffle in `server/src/lib/shuffleAlgorithms.ts`
- Cron emits a single summary log per run: "X shuffled, Y deleted (of N due)"
- Genre detection uses Last.fm `artist.getTopTags` (better underground coverage than Spotify)
- Audio features use ReccoBeats API (Spotify deprecated their audio features endpoint Nov 2024)
- ReccoBeats batch size capped at 40 IDs (not 50)
- Liked Songs use `/me/tracks` endpoint (not included in `/me/playlists`)
- Spotify write endpoints require `/items` not `/tracks` (deprecated, returns 403)
- Prisma JSON columns may return as strings — always parse: `typeof f === 'string' ? JSON.parse(f) : f`
- `platformUserId` stored in localStorage after login for frontend ownership checks
- Neon PostgreSQL free tier auto-suspends — first connection may be slow; use `directUrl` for `prisma migrate dev`
- `PlaylistDetail.tsx` is split into three hooks (`usePlaylistTracks`, `usePlaylistActions`, `useReshuffleSchedule`) and two components (`TrackRow`, `DuplicatesWarning`) — keep business logic in hooks, not in the page
