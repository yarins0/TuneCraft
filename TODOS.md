# TuneCraft — Deferred Work

Items tracked here were explicitly considered and deferred during planning.
Each has enough context to be picked up without re-reading the original conversation.

Tasks are divided into independent agents — each agent owns a separate slice of the codebase and can be worked on in parallel without conflicting with others.

---

# Agent C — Platform / API Reliability
> Owns: `server/src/lib/platform/tidal.ts`

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
