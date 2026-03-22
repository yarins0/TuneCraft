# TuneCraft — Deferred Work

Items tracked here were explicitly considered and deferred during planning.
Each has enough context to be picked up without re-reading the original conversation.

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

## Tidal end-to-end testing (deferred — no API credentials in env yet)

**What:** Manually test every Tidal flow once `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` are added to `server/.env` and a redirect URI is registered in the Tidal developer dashboard.

**Checklist:**
- [ ] Tidal OAuth login end-to-end (Login page → consent screen → Callback → Dashboard)
- [ ] Denying Tidal OAuth → `/login?error=denied` banner appears
- [ ] Tidal library loads in Dashboard (playlists + liked songs count)
- [ ] Platform Switcher: connect both Spotify + Tidal, switch between them, library reloads correctly
- [ ] Open a Tidal playlist: "Tidal" badge visible, "Open in" button links to correct Tidal URL, tracks load with enrichment
- [ ] Shuffle + Save writes new track order back to Tidal
- [ ] Save as Copy creates a new Tidal playlist
- [ ] Liked tracks load from Tidal favorites
- [ ] Auto-reshuffle cron fires for a Tidal playlist and writes back correctly
- [ ] PKCE state missing/tampered in callback → server returns 400, does not crash

**Why deferred:** Requires a Tidal developer app at developer.tidal.com/dashboard with `TIDAL_CLIENT_ID` + `TIDAL_CLIENT_SECRET` in `server/.env`. Redirect URI `http://127.0.0.1:3000/auth/tidal/callback` must be registered.

**Effort:** S (human: ~1–2 hours manual testing once credentials are ready)
**Priority:** P1 (must complete before publish)
**Depends on:** Tidal developer app registered + credentials filled in `.env`

---

## Tidal (and SoundCloud) audio feature enrichment via ISRC → Spotify is broken

**What:** Tracks from non-Spotify platforms (Tidal, SoundCloud) never get audio features or genres in the UI. The pipeline stalls at Phase 0 (ISRC → Spotify ID lookup) because Spotify's client credentials search endpoint aggressively rate-limits the server.

**Root cause:** The enrichment pipeline uses Spotify's public search API (`isrc:<code>`) to bridge a Tidal/SoundCloud ISRC to a Spotify track ID, which ReccoBeats requires. Spotify rate-limits this endpoint per app token (shared across all users). Any burst — even from a single earlier session — triggers a `Retry-After: 120s`, and with 5 retries that's up to 10 minutes of silent waiting. Once the wait is over, features do eventually land in the DB and get picked up by polling, but the wait is unacceptable UX.

**What's already in place:**
- Sequential ISRC lookups with 1s gap (prevents bursts)
- `Retry-After` cap raised to 120s so retries don't land inside the same window
- In-flight deduplication (`enrichingIds` Set) prevents stacked enrichment on page reload

**What still needs to be solved — options:**
1. **Cache the ISRC → Spotify ID mapping** in the DB (new `IsrcCache` table or a column on `TrackCache`). Once an ISRC is resolved, never call Spotify search again for it. Eliminates the rate-limit problem after first enrichment per track.
2. **Replace Spotify ISRC search** with a different lookup source (e.g. MusicBrainz has a free ISRC → recording API with no auth required). Would remove the Spotify dependency entirely for non-Spotify users.
3. **Accept slow first-load** and surface a "Enriching…" status to the user so the 1–2 min wait doesn't look broken.

**Where to start:** `server/src/lib/enrichment.ts` Phase 0, `server/src/lib/isrcLookup.ts`

**Effort:** M
**Priority:** P0 (blocks Tidal and SoundCloud from being usable)
**Depends on:** Nothing — can be picked up independently

---

## Tidal Dashboard: owned vs followed playlists not split correctly

**What:** The Dashboard doesn't correctly separate playlists the user owns from playlists they follow on Tidal. They appear mixed or in the wrong bucket.

**Where to start:** `server/src/lib/platform/tidal.ts` — `fetchPlaylists` / `fetchLibrary`. Check what field Tidal returns to indicate ownership (likely `data.attributes.privacy` or a relationship like `owners`). Compare with how Spotify handles `owner.id === userId`.

**Effort:** S
**Priority:** P1

---

## Tidal genres never appear — verify raw API response before falling back to Last.fm

**What:** Genre tags are empty for all Tidal tracks. We currently fall back to Last.fm, but it's unclear whether Tidal's API actually returns genre data and we're just parsing it wrong, or whether it genuinely returns nothing.

**What to do:** Log the raw genre relationships from the Tidal v2 API response for a known track that should have genres. Confirm whether `relationships.genres.data` is empty or populated, and what `attributes` look like on genre resources. Only rely on Last.fm fallback if Tidal genuinely returns no data.

**Where to start:** `server/src/lib/platform/tidal.ts` — `buildTrackV2`, the `genresMap` and `genreRefs` logging added during debugging.

**Effort:** S
**Priority:** P1

---

## PlaylistDetail UI: track/playlist name links should open in new tab AND support middle-click / mouse-wheel

**What:** Clicking a track name or playlist name currently opens it in a new tab via `window.open`. This should instead use a proper `<a href="..." target="_blank" rel="noopener noreferrer">` so that middle-click, Ctrl+click, and browser context menu ("Open in new tab") all work natively.

**Note:** Track detail layout redesign is also planned here — ask user for specifics when picking this up.

**Where to start:** `client/src/components/TrackRow.tsx` and any playlist name links in `client/src/pages/PlaylistDetail.tsx`.

**Effort:** S
**Priority:** P2

---

## Spotify: playlists created by the app are not flagged as "followed"

**What:** When TuneCraft creates a new Spotify playlist (via Split or Copy), it does not automatically follow it on behalf of the user. As a result the playlist doesn't appear in the user's Spotify library sidebar.

**Where to start:** `server/src/lib/platform/spotify.ts` — after `createPlaylist`, call the Spotify "Follow Playlist" endpoint (`PUT /v1/playlists/{id}/followers`).

**Effort:** XS
**Priority:** P1

---

## Tidal: display name not shown in sidebar — check raw API response

**What:** The user's display name doesn't appear in the platform switcher sidebar for Tidal. Likely the field name in the Tidal `/users/me` response differs from what we're reading.

**What to do:** Log the raw response from Tidal's user profile endpoint and confirm the correct field name (may be `data.attributes.username`, `data.attributes.name`, or similar).

**Where to start:** `server/src/lib/platform/tidal.ts` — `fetchUser` or equivalent profile fetch.

**Effort:** XS
**Priority:** P2

---

## "Switch account" and "Connect another platform" should support opening in a new tab

**What:** The sidebar buttons for switching accounts and connecting another platform navigate within the same tab. Users should be able to middle-click or right-click → "Open in new tab" to keep their current playlist view open.

**Where to start:** `client/src/components/PlatformSwitcherSidebar.tsx` — replace `onClick` navigation with `<a href="...">` or add `target="_blank"` support.

**Effort:** XS
**Priority:** P2

---

## ~~Server-side comment cleanup — remove platform-specific references from generic files~~ ✅ DONE

**What:** Update comments in `server/src/lib/enrichment.ts` and `server/src/routes/playlists.ts` that reference Spotify/SoundCloud/Tidal by name in code that is otherwise platform-agnostic. Replace with generic terms like "platform-native ID", "adapter-declared idField", etc.

**Why:** Consistent with the principle that non-platform-specific files should have zero knowledge of which platforms exist. Currently only comments are affected — no behavioral impact — but stale coupling in docs misleads future contributors.

**Where to start:** Search for `Spotify`, `SoundCloud`, `Tidal` in `enrichment.ts` lines 31–55 and `playlists.ts` lines 155–165. All changes are comment-only.

**Effort:** XS (human: ~15 minutes / CC: ~2 minutes)
**Priority:** P3 (polish, no behavioral impact)
**Depends on:** Nothing — standalone cleanup, safe to do any time

---

