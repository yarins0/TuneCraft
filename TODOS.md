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

## ~~Server-side comment cleanup — remove platform-specific references from generic files~~ ✅ DONE

**What:** Update comments in `server/src/lib/enrichment.ts` and `server/src/routes/playlists.ts` that reference Spotify/SoundCloud/Tidal by name in code that is otherwise platform-agnostic. Replace with generic terms like "platform-native ID", "adapter-declared idField", etc.

**Why:** Consistent with the principle that non-platform-specific files should have zero knowledge of which platforms exist. Currently only comments are affected — no behavioral impact — but stale coupling in docs misleads future contributors.

**Where to start:** Search for `Spotify`, `SoundCloud`, `Tidal` in `enrichment.ts` lines 31–55 and `playlists.ts` lines 155–165. All changes are comment-only.

**Effort:** XS (human: ~15 minutes / CC: ~2 minutes)
**Priority:** P3 (polish, no behavioral impact)
**Depends on:** Nothing — standalone cleanup, safe to do any time

---

