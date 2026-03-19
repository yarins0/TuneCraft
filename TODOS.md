# TuneCraft — Deferred Work

Items tracked here were explicitly considered and deferred during planning.
Each has enough context to be picked up without re-reading the original conversation.

---

## ~~Platform Switcher Sidebar~~ ✅ DONE

**What:** A sidebar or dropdown triggered from the Dashboard header that lets users switch between their Spotify library view and their SoundCloud library view without re-logging in.

**Why:** Once a user has connected both Spotify and SoundCloud, the current dashboard only shows one platform's library (whichever they logged in with). There's no way to browse the other platform's playlists without logging out and back in with a different account. This is a critical UX gap for multi-platform users.

**Pros:** Unlocks the full value of multi-platform support. Users can manage Spotify and SoundCloud libraries in the same session. Clear platform identity for each view.

**Cons:** Requires storing multiple active sessions (or re-fetching playlists per platform switch). Dashboard state (selected playlists, merge mode) needs to be scoped per-platform or reset on switch. Non-trivial auth model change.

**Context:** The current auth model stores one `userId` in `localStorage` per session. Each user record in the DB has a `platform` field. To support simultaneous multi-platform access, the client needs to store multiple userIds (one per platform) and the API calls need to route to the correct one. The dashboard header at `Dashboard.tsx:212` is the natural anchor point for a platform switcher UI element. Design intent: a sidebar that slides in from the left showing "Your accounts" — each connected platform as a card with artwork/avatar, switching updates the dashboard library view. Reference: `DESIGN.md` for visual patterns.

**Effort:** M (human: ~2 days / CC: ~45 min)
**Priority:** P2
**Depends on:** At least two platforms must be simultaneously connectable (SoundCloud integration complete ✅).

---

## SoundCloud end-to-end testing (deferred — no API key yet)

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

**Why deferred:** Requires a registered SoundCloud developer app (`soundcloud.com/you/apps`) with `SOUNDCLOUD_CLIENT_ID` + `SOUNDCLOUD_CLIENT_SECRET` in `server/.env`. SoundCloud app approval can take time.

**Effort:** S (human: ~1–2 hours manual testing once credentials are ready)
**Priority:** P1 (must complete before publish)
**Depends on:** SoundCloud developer app created + credentials filled in `.env`

---

## ~~SoundCloud playlist URL parsing in the Discover flow~~ ✅ DONE

**What:** Add SoundCloud URL parsing to `extractPlaylistId()` in `client/src/utils/platform.ts` so SoundCloud users can paste a playlist URL into the "Discover any playlist" box on the dashboard.

**Why:** SoundCloud playlist URLs look like `soundcloud.com/username/sets/playlist-name` — completely different from Spotify's `open.spotify.com/playlist/ID` format. The current regex only handles Spotify URLs. Pasting a SoundCloud URL currently returns null and the discover box silently does nothing.

**Pros:** Gives SoundCloud users full parity with Spotify for the discover flow.

**Cons:** SoundCloud URLs are slug-based (not ID-based), so resolving them requires an API call: `GET /playlists?url=https://soundcloud.com/...` to get the numeric playlist ID. This adds server-side logic to the discover route.

**Context:** The Discover flow lives in `Dashboard.tsx` (paste input) → `client/src/api/playlists.ts` (calls `/discover/:playlistId`) → `GET /playlists/:userId/discover/:playlistId` in `server/src/routes/playlists.ts`. Currently the client extracts the ID from the URL client-side before sending to the server. For SoundCloud slugs, the client can't do this — the server needs to resolve the slug via `GET https://api.soundcloud.com/resolve?url=...`.

**Effort:** S (human: ~1 day / CC: ~20 min)
**Priority:** P2
**Depends on:** SoundCloud adapter must be implemented first (Phase 6 SoundCloud integration).
