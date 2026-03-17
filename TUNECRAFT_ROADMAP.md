# Tunecraft — Feature Roadmap

## Core Philosophy
Give users smarter, more powerful control over their Spotify playlists than Spotify's default experience offers.

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
- [x] Pass spotifyId to frontend after login (needed for ownership checks)
- [x] Liked Songs special card on dashboard (uses /me/tracks endpoint)
- [x] Ownership indicator on playlist cards (yours vs following)
- [x] Frontend API function for tracks
- [x] Donut charts for audio features (collapsible section)
- [x] Track list with album art, artist, duration, BPM, genres
- [x] [Save] button for owned playlists
- [x] [Save as Copy] button with rename modal before saving
- [x] Shuffle button with multi-algorithm selection modal
- [x] Paginated track loading with background auto-fetch
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

## Phase 5 — Playlist Organizer 🔨 IN PROGRESS
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
  - [x] By energy, danceability, valence, acousticness, instrumentalness, speechiness, tempo (low/medium/high buckets using audio features)
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

## Phase 6 — Playlist Builder (Future)
Build new playlists intelligently based on what's already in the user's library.

### Genre-Based Builder
- [ ] Scan user's existing playlists
- [ ] Identify and group songs by genre
- [ ] Auto-generate new playlists from genre clusters
- [ ] Example: "Your Rock Mix", "Your Chill Vibes", "Your Workout Tracks"

### Weighted Shuffle
- [ ] Songs not heard recently get higher probability of appearing earlier in the shuffle
- [ ] Uses Spotify's `GET /me/player/recently-played` (returns up to 50 most recent plays with timestamps) — no new external API needed
- [ ] Tracks absent from recent history are treated as "cold" and weighted up; tracks in recent history are weighted down
- [ ] Basic version requires no DB changes — works within Spotify's 50-track window
- [ ] Enhanced version: add a `PlayHistory` table to track plays over time beyond Spotify's 50-track limit

---

### 🟡 UI Polish — Complete (pending merge)
- [x] Animated loading button labels (`useAnimatedLabel` hook) — applied to all modals and PlaylistDetail
- [x] SplitModal — clicking outside while dragging text should not close the modal (mousedown/mouseup delta check)
- [x] SplitModal — two-column layout (strategy picker left ~30%, preview list right ~70%), widen to `max-w-6xl`
- [x] PlaylistDetail — double-click track number to jump to position (inline number input, Enter/blur to confirm, clamp to valid range)
- [x] ShuffleModal — saving a new auto-reshuffle schedule writes `lastReshuffledAt = now` and `nextReshuffleAt = now + intervalDays` to DB so the cron window starts from the moment of activation
- [x] ShuffleModal — manually shuffling a playlist with an active schedule updates `lastShuffledAt` and `nextReshuffleAt` in DB
- [x] ShuffleModal — schedule button label bug fixed (API field name mismatch caused schedule to never load)

---

## 🌿 Pending Branches — UI Polish Session

Each change below lives on its own branch. Test each one before merging into `main`.

| Branch | What it changes | Key files |
|---|---|---|
| `ui/split-modal-two-column` | Two-column layout, close-on-drag fix | `SplitModal.tsx` |
| `fix/reshuffle-schedule-label` | API field mismatch fix (`playlists`→`schedules`, `playlist`→`schedule`), `autoEnabled` sync | `reshuffle.ts` (server), `ShuffleModal.tsx` |
| `fix/shuffle-reshuffle-timestamps` | Update DB timestamps on manual shuffle, delete stale DB record on Spotify 404 | `playlists.ts` (server) |
| `feat/schedule-immediate-shuffle` | Stamp `lastReshuffledAt = now` when activating a schedule so the cron window starts from activation | `reshuffle.ts` (server) |
| `feat/track-jump-to-position` | Double-click track number → inline input → move to position | `PlaylistDetail.tsx` |
| `fix/reccobeats-lastfm-rate-limiting` | Sequential batching for ReccoBeats + Last.fm with concurrent phases | `playlists.ts` (server) |
| `fix/spotify-write-serialization` | Serial async queue for all Spotify write routes (shuffle, save, copy, merge, split) | `playlists.ts` (server) |

### How to review and merge each branch

**1. Check what the branch changes**
```bash
git log main..<branch-name> --oneline        # see commits on the branch
git diff main...<branch-name>                # see all changed lines vs main
```

**2. Test it locally**
```bash
git checkout <branch-name>
npm run dev                                  # starts server + client + Prisma Studio
```
Then manually test the feature described in the table above.

**3. If it looks good — merge into main**
```bash
git checkout main
git merge <branch-name>
```

**4. If you want to discard it**
```bash
git branch -d <branch-name>                 # safe delete (only works if already merged)
git branch -D <branch-name>                 # force delete
```

**Recommended merge order** — some branches touch the same files, so merge in this sequence to avoid conflicts:
1. `fix/reshuffle-schedule-label`
2. `fix/shuffle-reshuffle-timestamps`
3. `feat/schedule-immediate-shuffle`
4. `ui/split-modal-two-column`
5. `feat/track-jump-to-position`
6. `fix/reccobeats-lastfm-rate-limiting`
7. `fix/spotify-write-serialization`



### 🔴 Spotify API Rate Limiting (Pre-publish blocker)
- Spotify's rolling 30-second request window causes 429 errors under load (large playlists, frequent saves)
- `spotifyRequestWithRetry` handles retries for individual requests, but parallel requests can both hit the limit simultaneously
- Need to audit all Spotify write paths (shuffle, save, copy, split, merge) and ensure requests are serialized or throttled rather than fired in parallel

### 🔴 ReccoBeats Audio Feature Rate Limiting (Pre-publish blocker)
- Audio feature requests for large playlists are all fired in parallel, overwhelming the ReccoBeats API
- Fix: process requests in small sequential batches (e.g. 5 at a time) with ~300ms delay between batches instead of `Promise.all`

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
GET  /playlists/:userId/:spotifyId/tracks        → playlist tracks (paginated)
POST /playlists/:userId/:spotifyId/shuffle       → write shuffled order to Spotify
POST /playlists/:userId/copy                     → create a named copy in user's account
PUT  /playlists/:userId/:spotifyId/save          → save track order (owned only)
POST /playlists/:userId/merge                    → merge multiple playlists into one new playlist
POST /playlists/:userId/:spotifyId/split         → split one playlist into multiple by strategy
GET  /playlists/:userId/duplicates               → find duplicate tracks across all playlists
```

## Ownership Logic
```
playlist.owner.id === user.spotifyId → show [Save] + [Save as Copy]
playlist.owner.id !== user.spotifyId → show [Save as Copy] only
spotifyId === 'liked'                → show [Save as Copy] only (not a real playlist)
```

## Technical Notes
- Auto-reshuffle requires background jobs → use `node-cron`
- Server-side shuffle kept in `server/src/lib/shuffleAlgorithms.ts` for use by cron job
- Genre detection uses Last.fm `artist.getTopTags` (better underground coverage than Spotify)
- Audio features use ReccoBeats API (Spotify deprecated their audio features endpoint Nov 2024)
- Liked Songs use `/me/tracks` endpoint (not included in `/me/playlists`)
- Spotify write endpoints require `/items` not `/tracks` (deprecated, returns 403)
- Spotify API restrictions for new apps: other users' playlists inaccessible in development mode
- Track count on playlist cards shows 0 — Spotify's `/me/playlists` doesn't return accurate counts
- spotifyId stored in sessionStorage after login for frontend ownership checks
- Copy playlist name is now set by the user via CopyModal before the API call is made
- ReccoBeats batch size capped at 40 IDs (not 50); chunk size set to 40
- Prisma JSON columns may return as strings — always parse: `typeof f === 'string' ? JSON.parse(f) : f`