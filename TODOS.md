# TuneCraft — Deferred Work

Items tracked here were explicitly considered and deferred during planning.
Each has enough context to be picked up without re-reading the original conversation.

Tasks are divided into independent agents — each agent owns a separate slice of the codebase and can be worked on in parallel without conflicting with others.

---

## Agent Registry
<!-- NEVER delete rows from this table — even when all tasks for an agent are done.
     This prevents re-using a letter for a different domain and losing track of ID history.
     Add a row here whenever a new agent is created. -->

| Agent | Description                 | Owns                                                                                                             | Highest ID | Status                |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| A     | Auth & Login UI             | `client/src/pages/Login.tsx`, `server/src/routes/auth.ts`                                                        | A?         | ✅ All tasks complete |
| B     | Playlist UI — core features | `client/src/components/`, `client/src/pages/PlaylistDetail.tsx`                                                  | B?         | ✅ All tasks complete |
| C     | Platform / API Reliability  | `server/src/lib/platform/tidal.ts`, `spotify.ts`, `soundcloud.ts`, `types.ts`, `registry.ts`                    | C5         | 🔵 Active             |
| D     | QA / Manual Testing         | _(no code — manual testing only)_                                                                                | D2         | 🔵 Active             |
| E     | Performance & Enrichment    | `server/src/lib/enrichment.ts`                                                                                   | E2         | 🔵 Active             |
| F     | Playlist Features / UI      | `client/src/pages/PlaylistDetail.tsx`, `client/src/components/SplitModal.tsx`, `server/src/routes/playlists.ts` | F2         | 🔵 Active             |
| G     | YouTube Music Platform      | `server/src/lib/platform/youtube.ts`, `server/src/routes/auth.ts`, `client/src/utils/platform/youtube.ts`       | G1         | 🟡 Testing needed     |

---

# Agent F — Playlist Features / UI
> Owns: `client/src/pages/PlaylistDetail.tsx`, `client/src/components/SplitModal.tsx`, `server/src/routes/playlists.ts`

## F2 · Open merged playlist immediately after creation

**What:** After a merge completes, navigate to the new playlist in the same tab (or open it in a new tab) so the user can see it loading — tracks stream in progressively just like any other playlist, instead of requiring the user to find it in their library.

**Why:** The merge flow already shows a success toast, but the user has no direct path to the newly created playlist. Opening it automatically matches the experience of Copy (which opens in a new tab) and makes the feature feel complete.

**What to change:**
- `server/src/routes/playlists.ts` — ensure the `POST /:userId/merge` response returns the new playlist's `platformId`, `name`, and `ownerId` (same shape as the copy response)
- `client/src/components/MergeModal.tsx` — after `onMergeComplete` callback, use `window.open('/playlist/{platformId}?name=...&ownerId=...', '_blank')` (same pattern as `handleConfirmCopy` in `usePlaylistActions.ts`)
- `client/src/hooks/usePlaylistActions.ts` — add a `handleConfirmMerge` handler (or extend the existing merge call) that receives the new playlist data and opens it

**Effort:** S
**Priority:** P3

**Risk:** Opening the new playlist immediately after a write means the client fetches it before the platform has fully propagated the new playlist and its tracks. May need a short delay or a retry loop before navigating, otherwise the track list arrives empty. Needs testing on each platform to confirm propagation timing before committing to this approach.

---

## ~~F1 · Allow split on followed (non-owned) playlists~~ ✅ DONE

Removed the `isOwner &&` guard from the Split button in `PlaylistDetail.tsx`. Split was already sharing the guard with Save; the two buttons were separated so Save remains owner-only while Split is now available for all playlists.

---

# Agent C — Platform / API Reliability
> Owns: `server/src/lib/platform/tidal.ts`, `server/src/lib/platform/spotify.ts`, `server/src/lib/platform/soundcloud.ts`, `server/src/lib/platform/types.ts`, `server/src/lib/platform/registry.ts`

## ~~C4 · Refactor platform adapter files — single-responsibility functions~~ ✅ DONE

Extracted `fetchEnrichmentMaps()` into `enrichment.ts` — replaces 6 copy-pasted
readEnrichmentCache + backgroundEnrichTracks blocks across all three adapters.
Also extracted `buildTidalEnrichmentInput` and `tidalWriteHeaders` within `tidal.ts`
to remove internal duplication. No behavior changes; tsc --noEmit clean.

---

## ~~C5 · Investigate Spotify117 API for followed playlist track access ~~— ⛔ BLOCKED

Endpoint confirmed (`/spotify_playlist/?url=...`), response shape documented in `.claude/NEW_APIS.MD`. API returns 500 consistently — the underlying Spotify scraper is down. This is a third-party reliability problem; no fix on our side.

**Alternative:** prompt users to "Save as copy" a followed playlist before shuffling. Reliable, no dependency on scrapers.

Re-evaluate if a working alternative RapidAPI appears.

---

## ~~C3 · Tidal Liked Songs: 3 tracks still missing after two-pass fix~~ ✅ DONE

Replaced the two `addedAt`/`-addedAt` passes with a single `title` (alphabetical) sort pass. Timestamp-based cursors were non-deterministic for bulk-imported tracks sharing the same `addedAt`; alphabetical cursors are independent of import time and return all tracks in one pass. Confirmed 385/385 in testing.

---

# Agent G — YouTube Music Platform
> Owns: `server/src/lib/platform/youtube.ts`, `server/src/routes/auth.ts`, `client/src/pages/Login.tsx`

## G1 · Add YouTube Music as a supported platform 🔵 ACTIVE — testing in progress

**What:** Implement a full `YouTubeAdapter` that satisfies `PlatformAdapter`, add OAuth login, and surface YouTube Music in the Login page alongside Spotify, SoundCloud, and Tidal.

**Why:** YouTube Music has a massive user base. Adding it gives TuneCraft access to the largest music library and the most potential users.

### Decision: YouTube Data API v3 (official)

The unofficial `ytmusic-api` wrapper was evaluated and rejected:
- It uses internal cookie-based auth (not OAuth 2.0) — incompatible with the server-side token model used by all other adapters
- It would break silently when Google changes internal endpoints
- Rate limits are undocumented

**YouTube Data API v3 was chosen instead.** YouTube Music playlists are standard YouTube playlists and are fully accessible via the official API. OAuth 2.0 authorization code flow is supported with `access_type=offline` for refresh tokens. This keeps the adapter consistent with every other platform.

**Important scope note:** the adapter targets *music playlists only*, not general YouTube video content. `fetchPlaylists` returns the user's playlists (which in a YouTube Music context are music playlists). `fetchLikedTracks` uses the user's liked-videos playlist ID from `channel.contentDetails.relatedPlaylists.likes` — this is the best available approximation of "Liked Music" via the official API.

### What was shipped

**Platform key:** `YOUTUBE` (not `YOUTUBE_MUSIC` as originally planned — kept shorter for consistency with other single-word keys)

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | Added `YOUTUBE` to `Platform` enum; `youtubeId` on `TrackCache`; `youtubeArtistId` on `ArtistCache` |
| `server/src/lib/platform/types.ts` | Added `'YOUTUBE'` to `Platform` union |
| `server/src/lib/platform/youtube.ts` | New — full `YouTubeAdapter` (OAuth, read, write, Innertube enrichment) |
| `server/src/lib/platform/registry.ts` | Registered `YouTubeAdapter` |
| `server/src/routes/auth.ts` | Added `/auth/youtube/callback` |
| `client/src/utils/platform/youtube.ts` | New — `youtubeConfig` (label, color, URLs, `extractPlaylistId`) |
| `client/src/utils/platform.ts` | Registered `youtubeConfig` under key `YOUTUBE` |
| `client/src/index.css` | Added `--color-platform-youtube: #FF0000` |
| `server/.env.example` | Added `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` section |
| `server/prisma/migrations/` | Migration: `add-youtube-platform` applied |

### What was fixed during testing (2026-03-31)

| Fix | File | Detail |
|---|---|---|
| Artist names: "Radiohead - Topic" → "Radiohead" | `youtube.ts` | `stripTopicSuffix` + `parseArtistFromTitle` applied in `buildTrack` |
| Album names from Innertube flex columns | `youtube.ts` | `fetchYtmusicMeta` parses `MUSIC_PAGE_TYPE_ALBUM` runs anonymously for public playlists |
| Liked songs: filter to music-only | `youtube.ts` | `isMusicVideo` predicate (categoryId === '10') applied in `fetchLikedTracks` |
| Followed playlists missing from dashboard | `youtube.ts` | `fetchLibraryPlaylists` makes authenticated Innertube call to `FEmusic_library_privately_owned_playlists`; merged with Data API results |
| Auth failure showed blank JSON page | `auth.ts` | Callback catch now redirects to `/?error=auth_failed` instead of returning `res.status(500).json(...)` |
| Last.fm queried with "Artist - Topic" names | `youtube.ts` | `resolveArtist` now applied to enrichment input `artistName`, not just `buildTrack` display name |
| 409 ABORTED on playlist save | `youtube.ts`, `requestWithRetry.ts` | `extraRetryCodes` param added to `requestWithRetry`; insert loop passes `[409]` with 5s wait + 200ms pause between inserts |

### Known limitations

- **Album metadata only for public playlists** — Innertube album enrichment uses anonymous browse; private playlists silently fall back to empty album name.
- **Audio features sparse** — YouTube does not provide ISRC. Features will only appear for tracks MusicBrainz can cross-reference to a Spotify ID by title + artist.
- **Playlist write quota** — YouTube's default daily quota is 10,000 units. Replacing a 100-track playlist costs ~10,000 units (each delete + insert = 50 units). Large playlists may exhaust the daily quota in a single save.
- **`fetchLikedTracks` uses Liked Videos** — YouTube Music's "Liked Music" playlist is not separately exposed by the official API. The liked-videos playlist is used as the best available proxy; non-music liked videos may appear alongside songs.

### Still needed

- [X] **G1-save-verify** — re-test duplicate removal + save after 409 retry fix (5s wait, 200ms insert pacing). Was blocked by daily quota exhaustion on 2026-03-31.
- [X] **G1-followed-verify** — ⛔ CONFIRMED LIMITATION. The YouTube Data API v3 has no endpoint for playlists saved from other channels. Innertube browse endpoints that expose the full library (`FEmusic_library_privately_owned_playlists`, `FEmusic_liked_playlists`) require cookie-based session auth (SAPISID) and return 400 with OAuth Bearer tokens. Only user-owned playlists are returned. `fetchLibraryPlaylists` is now a no-op stub pending a future official API.
- [ ] **G1-full-checklist** — run the full D2-style end-to-end checklist once quota resets (midnight Pacific):
  - [X] OAuth login, deny flow, access request modal
  - [ ] Dashboard: owned + followed playlists visible
  - [X] Liked songs: music-only filter — ⛔ CONFIRMED LIMITATION. Innertube `FEmusic_liked_videos` (the true YTM library songs endpoint) returns 400 with OAuth Bearer tokens, same as all other library browse endpoints. Current filter (liked-videos playlist + `categoryId === '10'`) is the best achievable via the official API.
  - [X] PlaylistDetail: correct artist names (no " - Topic"), album names for public playlists
  - [X] Shuffle + Save writes back to YouTube
  - [X] Save as Copy creates new playlist
  - [X] Split and Merge
  - [X] Auto-reshuffle + Clean-up cron

**Effort:** L (core done) → S (remaining testing)
**Priority:** P2

**NOTE:** YouTube button is currently set to `available: false` in `client/src/utils/platform/youtube.ts` — re-enable when testing resumes.

---

# Agent E — Performance
> Owns: `server/src/lib/enrichment.ts`

## ~~E2 · Complete RapidAPI sandbox~~ ✅ DONE

All three APIs tested. Findings:
- **Soundnet** (`track-analysis`) — endpoint `/pktx/spotify/{id}`, returns 0–100 integers (not 0–1 floats), `valence` named `happiness`. Requires paid subscription; free tier is 3 req/day. Not viable.
- **Spotify117** — endpoint confirmed (`/spotify_playlist/?url=...`), scraper currently returns 500. See C5.
- **Musicae** — not tested (soundnet result made it moot). ReccoBeats remains the audio features source.

---

## ~~E1 · ReccoBeats enrichment: adaptive request timing~~ ✅ DONE

Already implemented as a fixed 100ms delay (reduced from 300ms). Adaptive timing deferred indefinitely — progressive loading UX handles the wait gracefully and no user is blocked.

---

# Agent D — QA / Manual Testing
> No code changes — manual testing only. Unblocked only by credentials being available.

## D1 · SoundCloud end-to-end testing (deferred — no API key yet)

**What:** Manually test every SoundCloud flow once a SoundCloud developer app is created and credentials are added to `server/.env`.

**Checklist:**
- [ ] SoundCloud OAuth login end-to-end (Login page → consent screen → Callback → Dashboard)
- [ ] Denying SoundCloud OAuth → `/login?error=denied` banner appears
- [ ] SoundCloud library loads in Dashboard (playlists + liked songs count)
- [ ] Platform Switcher: connect both Spotify + SoundCloud, switch between them, library reloads correctly
- [ ] "Connect another platform" in sidebar navigates to Login page
- [ ] Discover a SoundCloud playlist by URL (`soundcloud.com/user/sets/name`) → resolves and navigates
- [ ] PlaylistDetail for a SoundCloud playlist: "SoundCloud" badge visible, "Open in" button links to correct SC URL
- [ ] Insights tab on SC playlist with low audio feature coverage → charts hidden, fallback message shown
- [ ] Split modal on SC playlist with low coverage → audio feature strategies greyed out
- [ ] Shuffle a SoundCloud playlist → saves to SoundCloud
- [ ] Split a SoundCloud playlist → creates new playlists on SoundCloud
- [ ] Auto-reshuffle cron fires for a SoundCloud playlist

**Why deferred:** Requires a registered SoundCloud developer app with `SOUNDCLOUD_CLIENT_ID` + `SOUNDCLOUD_CLIENT_SECRET` in `server/.env`.

**Effort:** S (~1–2 hours manual testing once credentials are ready)
**Priority:** P1 (must complete before publish)
**Depends on:** SoundCloud developer app created + credentials filled in `.env`

---

## ~~D2 · Tidal end-to-end testing~~ ✅ COMPLETE

**What:** Manually test every Tidal flow once `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` are added to `server/.env` and a redirect URI is registered in the Tidal developer dashboard.

**Checklist:**
- [x] Tidal OAuth login end-to-end (Login page → consent screen → Callback → Dashboard)
- [x] Denying Tidal OAuth → `/login?error=denied` banner appears
- [x] Tidal library loads in Dashboard (playlists + liked songs count)
- [x] Platform Switcher: connect both Spotify + Tidal, switch between them, library reloads correctly
- [x] Open a Tidal playlist: "Tidal" badge visible, "Open in" button links to correct Tidal URL, tracks load with enrichment
- [x] Shuffle + Save writes new track order back to Tidal
- [x] Save as Copy creates a new Tidal playlist
- [x] Liked tracks load from Tidal favorites
- [x] Auto-reshuffle cron fires for a Tidal playlist and writes back correctly
- [x] PKCE state missing/tampered in callback → server returns 400, does not crash

**Completed:** tidal branch (2026-03-24)

---
