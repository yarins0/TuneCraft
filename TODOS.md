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

## C4 · Refactor platform adapter files — single-responsibility functions

**What:** Each platform file (`spotify.ts`, `soundcloud.ts`, `tidal.ts`) has grown large with functions that do too much. Break them into smaller single-responsibility helpers, and promote any shared behaviour to the `PlatformAdapter` interface or a shared base so it isn't duplicated across adapters.

**Why:** Easier to maintain and extend — adding a new platform or fixing a bug in one adapter currently means reading through hundreds of lines of interleaved logic.

**What to change:**
- `server/src/lib/platform/spotify.ts` — audit each method, extract helpers, group by concern (auth, tracks, playlists, write ops)
- `server/src/lib/platform/soundcloud.ts` — same audit
- `server/src/lib/platform/tidal.ts` — same audit (largest file, highest priority)
- `server/src/lib/platform/types.ts` — identify any methods currently duplicated across adapters that belong on the interface (e.g. shared pagination logic, shared error mapping)
- `server/src/lib/platform/registry.ts` — no changes expected, but verify after refactor

**Effort:** M
**Priority:** P2

---

## C5 · Investigate Spotify117 API for followed playlist track access

**What:** Spotify's official API blocks reading track lists from playlists you follow but don't own. `spotify117.p.rapidapi.com` is a RapidAPI wrapper that may bypass this restriction. The sandbox in `server/sandbox/test-apis.ts` probed it but got 404 due to unknown endpoint paths.

**What to do:**
1. Find the correct endpoint paths from the RapidAPI playground: `https://rapidapi.com/420vijay47/api/spotify117/playground/apiendpoint_c10216d4-c8b0-4a65-9da3-c74209742540`
2. Update and re-run the sandbox (see E2 — can be done in the same run)
3. Check: does it return track IDs? Does it paginate? Does it require user OAuth or just a RapidAPI key?
4. If viable: plan an integration path — the fetched track IDs would feed into our existing enrichment pipeline, no changes to enrichment needed

**Files:** `server/sandbox/test-apis.ts`, `server/src/lib/platform/spotify.ts`

**Effort:** S
**Priority:** P2
**Depends on:** E2 (same sandbox run)

---

## C3 · Tidal Liked Songs: 3 tracks still missing after two-pass fix

**Current state:** `fetchLikedTracks` runs two full server-side page loops — one pass `sort=-addedAt` (newest-first), one pass `sort=addedAt` (oldest-first) — and deduplicates by track ID across both. This recovered 80/83 previously missing tracks. 3 remain missing because they sit at a cursor boundary in **both** sort orders simultaneously.

**What needs to be done:** Add a 3rd pass using a completely different sort key (e.g. `sort=title` or `sort=artists.name`). A different sort dimension shifts cursor boundaries to unrelated positions, so tracks stranded in both timestamp-based orderings will appear in the middle of the new sequence and be returned normally.

**Available sort keys** (confirmed from Tidal OpenAPI spec):
`addedAt`, `-addedAt`, `title`, `-title`, `artists.name`, `-artists.name`, `albums.title`, `-albums.title`, `duration`, `-duration`

**Implementation notes:**
- `SORT_ORDERS` in `fetchLikedTracks` is already a typed const array — add a 3rd entry (e.g. `'title'`)
- The dedup set already handles cross-pass duplicates — no extra logic needed
- Add a rate-limit pause before the 3rd pass (same 1000ms pattern as pass 2)
- Update the log line to say `3/3` passes

**File:** `server/src/lib/platform/tidal.ts` — `fetchLikedTracks` method

**Effort:** XS
**Priority:** P2

---

# Agent E — Performance
> Owns: `server/src/lib/enrichment.ts`

## E2 · Complete RapidAPI sandbox — find correct endpoint paths

**What:** A sandbox script exists at `server/sandbox/test-apis.ts` that tests three RapidAPI candidates, but all 6 probes returned 404 because the endpoint paths were guessed. The RapidAPI key is valid — the server responds — but the real paths must be looked up from the RapidAPI playground pages before the sandbox can produce results.

**APIs to test:**
- `track-analysis.p.rapidapi.com` (soundnet) — RapidAPI audio features candidate
- `spotify-extended-audio-features-api.p.rapidapi.com` (musicae) — another audio features candidate
- `spotify117.p.rapidapi.com` (420vijay47) — see C5 for this one

**What to do:**
1. Open the RapidAPI playground pages listed in `.claude/NEW_APIS.md` and read the actual endpoint paths
2. Update `server/sandbox/test-apis.ts` with the correct paths
3. Re-run `npx ts-node sandbox/test-apis.ts` from `server/`
4. Compare the response fields to ReccoBeats: `tempo, energy, danceability, valence, acousticness, instrumentalness, liveness, speechiness, loudness, key, mode, time_signature`
5. Check batch support (our pipeline sends 40 tracks at a time), ISRC support, and rate limits

**Decision criteria:** If either audio features API covers ≥ 80% of our fields with matching 0.0–1.0 value ranges and supports batch lookups, it's a viable ReccoBeats replacement or fallback.

**Files:** `server/sandbox/test-apis.ts`, `.claude/NEW_APIS.md`

**Effort:** XS
**Priority:** P2

---

## E1 · ReccoBeats enrichment: adaptive request timing

**Current state:** `backgroundEnrichTracks` Phase 3 waits a fixed 300ms between every ReccoBeats audio-feature request, regardless of whether the API is actually under pressure. This means a 500-track playlist takes ~150 seconds minimum to fully enrich.

**What needs to be done:** Replace the unconditional `await sleep(300)` with adaptive timing: only introduce a delay when ReccoBeats responds with 429, and use the `Retry-After` header value (already parsed by `requestWithRetry`). During low-traffic windows, the gap drops to near-zero; during rate-limit pressure, it backs off exactly as much as required.

**Implementation notes:**
- `requestWithRetry` already handles 429 back-off at the HTTP level — but Phase 3 calls it once per track and then sleeps regardless
- The fix: remove the unconditional `await sleep(300)` after `requestWithRetry`, and instead pass a callback or check the response timestamp to decide if a pause is needed
- Simpler alternative: halve the fixed delay to 150ms — ReccoBeats allows this in practice and cuts enrichment time by ~50% without any adaptive logic
- File: `server/src/lib/enrichment.ts` — Phase 3 loop (around line 644-668)

**Why deferred:** The progressive loading UX (features arrive one-by-one as the client polls) already handles the wait gracefully. No user is blocked. This is a UX improvement, not a correctness fix.

**Effort:** XS
**Priority:** P3

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
