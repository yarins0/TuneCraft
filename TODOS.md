# TuneCraft — Deferred Work

Items tracked here were explicitly considered and deferred during planning.
Each has enough context to be picked up without re-reading the original conversation.

Tasks are divided into independent agents — each agent owns a separate slice of the codebase and can be worked on in parallel without conflicting with others.

---

# Agent A — Enrichment & ArtistCache
> Owns: `server/src/lib/enrichment.ts`, `server/prisma/schema.prisma`
> Work these in order — each builds on the previous.

## ~~A1 · ArtistCache: platform tag is always "spotify" regardless of source~~ ✅ DONE

**What was done:** `uniqueMissedArtists` now carries `platform: Platform`. The `persistArtistGenres` helper stores the correct platform in the ArtistCache `platform` column (was always defaulting to `SPOTIFY` because the field was never passed through).

**File changed:** `server/src/lib/enrichment.ts`

---

## ~~A2 · ArtistCache: add per-platform ID columns~~ ✅ DONE

**What was done:** Added `spotifyArtistId`, `tidalArtistId`, `soundcloudArtistId` (all `String? @unique`) and `normalizedName String? @unique` to `ArtistCache` in `schema.prisma`. Applied via `npx prisma db push` (migration replay was blocked by a pre-existing inconsistency in the migration history; `db push` syncs directly). Added `artistCacheIdField()` helper mapping Platform → column name. Lookup and upsert logic updated to use per-platform columns.

**Files changed:** `server/prisma/schema.prisma`, `server/src/lib/enrichment.ts`

---

## ~~A3 · ArtistCache: duplicate entries for the same artist across platforms~~ ✅ DONE

**What was done:** `normalizedName` (lowercase + trimmed artist name) added as the primary ArtistCache upsert key. `buildArtistCacheOrConditions` now queries by normalizedName in addition to platform ID columns. `buildArtistGenreMap` indexes cached rows by normalizedName cross-reference so a Tidal track resolves genres from a Spotify-sourced row. `persistArtistGenres` upserts by normalizedName first — same artist, different platform IDs now share one row.

**File changed:** `server/src/lib/enrichment.ts`

---

## ~~A4 · Refactor: clean up and split `enrichment.ts` into focused functions~~ ✅ DONE

**What was done:** Extracted eight single-responsibility helpers: `buildArtistCacheOrConditions`, `buildArtistGenreMap`, `buildTrackCacheOrConditions`, `buildAudioFeaturesMap` (from `readEnrichmentCache`) and `resolveIsrcToSpotifyIds`, `fetchReccoBeatsIds`, `fetchArtistGenres`, `persistAudioFeatures`, `persistArtistGenres` (from `backgroundEnrichTracks`). Both public functions are now thin orchestrators. All helpers have inline doc-comments.

**File changed:** `server/src/lib/enrichment.ts`

---

# Agent B — Client / UI
> Owns: `client/src/components/TrackRow.tsx`, `client/src/pages/PlaylistDetail.tsx`
> Work these in order — search bar depends on album being on the track object.

## ~~B1 · TrackRow: add album data + new layout~~ ✅ DONE

**What was done:** `albumName` was already present on the `Track` type. Replaced the single-column info block in `TrackRow.tsx` with a CSS grid (`grid-cols-[2fr_1fr_1fr]`) — Track Name (col 1) + genre pills below it, Artist (col 2), Album (col 3). Added matching column headers above the track list in `PlaylistDetail.tsx`.

**File changed:** `client/src/components/TrackRow.tsx`

---

## ~~B2 · Feature: track search bar in PlaylistDetail~~ ✅ DONE

**What was done:** Added `searchQuery` state that resets on playlist navigation. Added a `filteredTracks` memo (returns `{ track, index }` tuples to preserve original indices for drag/jump/duplicate highlighting). Added a search input above the track list. Added an empty-search state. The track list now renders from `filteredTracks` — case-insensitive match across name, artist, and albumName.

**File changed:** `client/src/pages/PlaylistDetail.tsx`

---

# Agent C — Platform / API Reliability
> Owns: `server/src/lib/requestWithRetry.ts`, `server/src/lib/platform/tidal.ts`

## ~~C1 · Request retries should abort when the calling page is closed~~ ✅ DONE

**What was done:**
1. Added `sleepOrAbort` helper in `requestWithRetry.ts` — resolves after the back-off wait, but rejects early if the `AbortSignal` fires during the wait. Uses a one-time `'abort'` event listener + `clearTimeout` to avoid timer leaks.
2. Added optional `signal?: AbortSignal` as the 7th parameter to `requestWithRetry` — all existing callers are unaffected (it defaults to `undefined`).
3. The signal is merged into the axios config so the active in-flight HTTP call is cancelled immediately when the signal fires (axios surfaces this as a `CanceledError` with code `ERR_CANCELED`).
4. `axios.isCancel()` check added before the 429 retry branch so abort cancellations are re-thrown immediately rather than triggering a retry cycle.
5. Pre-attempt `signal.aborted` guard added so the loop exits cleanly without issuing a request if the signal already fired during the previous back-off.
6. In `routes/playlists.ts`, the `/:userId/:playlistId/tracks` route now creates an `AbortController` tied to `req.on('close')`. The signal is not yet threaded into `adapter.fetchPlaylistTracks()` — doing so requires adding an optional signal parameter to the `PlatformAdapter` interface and all adapter implementations, which is a broader refactor deferred separately.

**Files changed:** `server/src/lib/requestWithRetry.ts`, `server/src/routes/playlists.ts`

---

## ~~C2 · Tidal: bulk-write cursor instability — verify playlist pagination after copy/split/merge~~ ✅ DONE (investigation — no fix needed)

**Finding:** Tidal regular playlist pagination (`GET /playlists/{id}/relationships/items`) is position-based (insertion order), not `addedAt`-sorted. Timestamp collisions from bulk-writes do NOT cause cursor instability for regular playlists — the issue that required the all-pages/dedup fix in `fetchLikedTracks` does not apply here. `fetchPlaylistTracks` does not need the same treatment.

**Files changed:** None

---

## C3 · Tidal Liked Songs: pagination is fundamentally broken — ~83 tracks missing

**What:** `GET /userCollectionTracks/me/relationships/items` (JSON:API) does not support reliable pagination. For collections where many tracks were bulk-imported (they share the same `addedAt` timestamp), pages overlap and skip, so only ~411/494 tracks load. The current implementation terminates correctly (no infinite loop) but silently drops ~17% of tracks.

**Root cause (confirmed):**
Tidal's Liked Songs endpoint sorts by `addedAt` timestamp and generates cursors from that field. When many tracks share identical `addedAt` values (bulk import creates this), the cursor position is non-deterministic — each page request with the same cursor can return a different subset of tracks at that timestamp boundary. This causes simultaneous page overlap (duplicates) and skipping.

**Three approaches tried — all failed:**

1. **`page[offset]` pagination** — `page[offset]` is silently ignored on this endpoint. Every request returns the same first 20 tracks regardless of offset value. Causes an infinite load loop (the original bug).

2. **Cursor pagination with client-side dedup** — Terminates correctly. Removes duplicates (no false positives on genuinely unique tracks). But the skipping problem means ~83 tracks that are *not* duplicates are never returned by any page. Result: 411/494 tracks loaded. User confirmed: "only 411/494 were loaded, all the rest are the duplicates that were removed but the original had 494 different tracks."

3. **Server-side all-pages fetch in a single request** — Fetches all pages in a loop before returning, with dedup applied to the full set. Terminates but hits Tidal's rate limits for large collections before all pages load. User confirmed: "the liked playlist on tidal bashed the rate limit too much, it never loads."

**Current state:** Cursor pagination without dedup (approach 2, dedup removed). Terminates. Shows ~411/494 tracks for bulk-imported collections. No infinite loop.

**What a future fix should investigate:**
- `GET /userCollectionTracks/me` (non-relationships endpoint) — may support a different sort order or offset param
- Tidal developer forum / changelog for any new pagination parameters added to the likes endpoint
- Whether `page[size]` larger than 50 is accepted (reducing total requests reduces rate-limit exposure)
- Server-side all-pages with exponential back-off and a longer timeout budget (currently Tidal returns 429 before completion on large collections)

**Files to change:** `server/src/lib/platform/tidal.ts` — `fetchLikedTracks` method (~line 370)

**Effort:** M (needs Tidal API research + testing with a 400+ track liked collection)
**Priority:** P1 (known data loss — user sees fewer tracks than exist)
**Blocked by:** Need to find a Tidal API endpoint or pagination mode that works for this collection type

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

## D2 · Tidal end-to-end testing (deferred — no API credentials in env yet)

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

**Effort:** S (~1–2 hours manual testing once credentials are ready)
**Priority:** P1 (must complete before publish)
**Depends on:** Tidal developer app registered + credentials filled in `.env`

---

# Done ✅

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

**What was done:** Logged the raw first-track response from the Tidal v2 playlist API. `relationships.genres.data` is `[]` for all tracks — Tidal simply does not return genre data via its API. Reverted `buildTrackV2` to use `artistGenreMap` (Last.fm) as the genre source.

**File changed:** `server/src/lib/platform/tidal.ts`

---

## ~~Spotify: playlists created by the app are not flagged as "followed"~~ ✅ DONE

**What was done:** Added a `PUT /v1/playlists/{id}/followers` call inside `createPlaylist`, immediately after the playlist is created.

**File changed:** `server/src/lib/platform/spotify.ts`

---

## ~~Tidal: display name not shown in sidebar — check raw API response~~ ✅ DONE

**What was done:** Tidal PKCE apps receive no `firstName`/`lastName` — only `username` (which equals the user's email). Fixed `exchangeCode` to extract the local part before `@` so the sidebar shows a readable name.

**File changed:** `server/src/lib/platform/tidal.ts`

---

## ~~Server-side comment cleanup — remove platform-specific references from generic files~~ ✅ DONE

**What was done:** Updated comments in `server/src/lib/enrichment.ts` and `server/src/routes/playlists.ts` to use generic terms instead of platform names.

**Files changed:** `server/src/lib/enrichment.ts`, `server/src/routes/playlists.ts`

---
