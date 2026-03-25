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
| G     | YouTube Music Platform      | `server/src/lib/platform/youtube.ts`, `server/src/routes/auth.ts`, `client/src/pages/Login.tsx`                 | G1         | 🔵 Active             |

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

## C5 · Investigate Spotify117 API for followed playlist track access — ⛔ BLOCKED

Endpoint confirmed (`/spotify_playlist/?url=...`), response shape documented in `.claude/NEW_APIS.MD`. API returns 500 consistently — the underlying Spotify scraper is down. This is a third-party reliability problem; no fix on our side.

**Alternative:** prompt users to "Save as copy" a followed playlist before shuffling. Reliable, no dependency on scrapers.

Re-evaluate if a working alternative RapidAPI appears.

---

## ~~C3 · Tidal Liked Songs: 3 tracks still missing after two-pass fix~~ ✅ DONE

Replaced the two `addedAt`/`-addedAt` passes with a single `title` (alphabetical) sort pass. Timestamp-based cursors were non-deterministic for bulk-imported tracks sharing the same `addedAt`; alphabetical cursors are independent of import time and return all tracks in one pass. Confirmed 385/385 in testing.

---

# Agent G — YouTube Music Platform
> Owns: `server/src/lib/platform/youtube.ts`, `server/src/routes/auth.ts`, `client/src/pages/Login.tsx`

## G1 · Add YouTube Music as a supported platform

**What:** Implement a full `YouTubeMusicAdapter` that satisfies `PlatformAdapter`, add OAuth login for YouTube Music, and surface it in the Login page alongside Spotify, SoundCloud, and Tidal.

**Why:** YouTube Music has a massive user base. Adding it gives TuneCraft access to the largest music library and the most potential users.

**API situation (from NEW_APIS.MD):**
- There is **no official public API** for YouTube Music specifically.
- **Best option — `ytmusic-api` (NPM/TypeScript):** unofficial Node.js wrapper with TypeScript support. Covers search, library management (playlists, songs), and artist data. Uses OAuth cookies to act on behalf of the user.
- **Fallback — YouTube Data API v3:** official Google API, but only covers general YouTube data (videos, channels). Does not expose YouTube Music library features like playlists, liked songs, or "My Mix".
- Authentication is cookie/OAuth-header based rather than a standard OAuth 2.0 code flow — this is the biggest architectural difference from the existing platforms and needs careful design before implementation.

**What to change:**
- `server/src/lib/platform/youtube.ts` — new file; implement `YouTubeMusicAdapter` using `ytmusic-api` (or YouTube Data API v3 as fallback). Must satisfy the full `PlatformAdapter` interface: auth, fetchPlaylists, fetchPlaylistTracks, fetchLikedTracks, replacePlaylistTracks, addTracksToPlaylist, etc.
- `server/src/lib/platform/types.ts` — add `'YOUTUBE_MUSIC'` to the `Platform` union
- `server/src/lib/platform/registry.ts` — register the new adapter
- `server/src/routes/auth.ts` — add `/auth/youtube/login` and `/auth/youtube/callback` routes
- `client/src/pages/Login.tsx` — add YouTube Music connect button
- `prisma/schema.prisma` — add `YOUTUBE_MUSIC` to the `Platform` enum; add `youtubeId` column to `TrackCache` and `youtubeArtistId` to `ArtistCache`
- `server/src/lib/enrichment.ts` — no changes expected (platform-agnostic)

**Key risks / open questions:**
- Cookie-based auth is fragile — YouTube Music has no official OAuth 2.0 authorization code flow. Need to decide whether to use `ytmusic-api`'s cookie approach or restrict to YouTube Data API v3 (which loses library access).
- `ytmusic-api` is unofficial and could break if Google changes internal endpoints — same reliability concern as the Spotify117 scraper.
- Rate limits on the unofficial API are undocumented.
- Investigate whether YouTube Data API v3 (official) is sufficient for the core use cases before committing to the unofficial wrapper.

**Effort:** L
**Priority:** P2

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

## D2 · Tidal end-to-end testing ✅ COMPLETE

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
