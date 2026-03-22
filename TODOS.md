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

## ~~Tidal (and SoundCloud) audio feature enrichment via ISRC → Spotify is broken~~ ✅ DONE

**What was done:** Replaced the Spotify-only ISRC lookup with a two-stage pipeline:
1. **MusicBrainz first** — free, no auth, 1 req/sec. Resolves well-known/older tracks with zero Spotify API usage.
2. **Spotify search fallback** — used only when MusicBrainz misses (brand-new or niche releases). Rate-limit risk is now bounded to genuine first-time misses only.

Also fixed the client-side polling loop: it now stops after 30 consecutive empty polls instead of running forever for tracks that will never get audio features (e.g. no ReccoBeats coverage).

**Files changed:** `server/src/lib/isrcLookup.ts`, `client/src/hooks/usePlaylistTracks.ts`

---

## ~~Tidal Dashboard: owned vs followed playlists not split correctly~~ ✅ DONE

**What was done:** Diagnosed via targeted logging. Tidal's `owners.data` array is populated only for playlists the authenticated user owns; followed/editorial playlists return `data: []`. Fixed `fetchPlaylists` to set `ownerId = ''` when `owners.data` is empty, so the Dashboard correctly places those playlists in the Following section.

**File changed:** `server/src/lib/platform/tidal.ts`

---

## ~~Tidal genres never appear — verify raw API response before falling back to Last.fm~~ ✅ DONE

**What was done:** Logged the raw first-track response from the Tidal v2 playlist API. `relationships.genres.data` is `[]` for all tracks — Tidal's `links.self` for the genre relationship is a standard JSON:API self-link, not a hidden data source. Tidal simply does not return genre data via its API. Reverted `buildTrackV2` to use `artistGenreMap` (Last.fm) as the genre source, the same approach used for SoundCloud.

**File changed:** `server/src/lib/platform/tidal.ts`

---

## ~~Spotify: playlists created by the app are not flagged as "followed"~~ ✅ DONE

**What was done:** Added a `PUT /v1/playlists/{id}/followers` call inside `createPlaylist`, immediately after the playlist is created. The follow call is awaited but non-fatal — a failure logs a warning and returns the new playlist ID regardless.

**File changed:** `server/src/lib/platform/spotify.ts`

---

## ~~Tidal: display name not shown in sidebar — check raw API response~~ ✅ DONE

**What was done:** Diagnosed via login-time logging. Tidal PKCE apps receive no `firstName`/`lastName` — only `username`, which equals the user's email address. Fixed `exchangeCode` to extract the local part before `@` (e.g. `yarinso39` from `yarinso39@gmail.com`) so the sidebar shows a readable name instead of a full email or raw numeric ID.

**File changed:** `server/src/lib/platform/tidal.ts`

---


## ~~Server-side comment cleanup — remove platform-specific references from generic files~~ ✅ DONE

**What:** Update comments in `server/src/lib/enrichment.ts` and `server/src/routes/playlists.ts` that reference Spotify/SoundCloud/Tidal by name in code that is otherwise platform-agnostic. Replace with generic terms like "platform-native ID", "adapter-declared idField", etc.

**Why:** Consistent with the principle that non-platform-specific files should have zero knowledge of which platforms exist. Currently only comments are affected — no behavioral impact — but stale coupling in docs misleads future contributors.

**Where to start:** Search for `Spotify`, `SoundCloud`, `Tidal` in `enrichment.ts` lines 31–55 and `playlists.ts` lines 155–165. All changes are comment-only.

**Effort:** XS (human: ~15 minutes / CC: ~2 minutes)
**Priority:** P3 (polish, no behavioral impact)
**Depends on:** Nothing — standalone cleanup, safe to do any time

---

