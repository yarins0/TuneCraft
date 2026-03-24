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

## A8 · `buildArtistGenreMap` hard-codes per-platform artist ID columns

**What:** `buildArtistGenreMap` indexes the genre map by manually listing every platform's artist ID column name:
```ts
if (row.spotifyArtistId)    map[row.spotifyArtistId]    = genres;
if (row.tidalArtistId)      map[row.tidalArtistId]      = genres;
if (row.soundcloudArtistId) map[row.soundcloudArtistId] = genres;
```
Adding a new platform requires editing this function. `artistCacheIdField()` is already the correct registry (Platform → column name) — `buildArtistGenreMap` just doesn't use it.

**Why:** Platform-agnosticism is a first-class requirement across the project. Every file that breaks it becomes a maintenance trap — the next engineer adding Apple Music will have to hunt for all such lists.

**Root cause (if known):** The function was written to index by all known platform columns before the `artistCacheIdField` registry was promoted as the single source of truth.

**What to change:**
- `server/src/lib/enrichment.ts` — derive the list of known artist ID columns from `artistCacheIdField` instead of hard-coding them. Add a constant (e.g. `ALL_ARTIST_ID_FIELDS`) built by calling `artistCacheIdField` for all known `Platform` values, then replace the three hard-coded `if` lines in `buildArtistGenreMap` with a loop over that constant. When a new platform is registered in `artistCacheIdField`, the map indexing updates automatically.

**Note:** `spotifyId`, `resolveIsrcToSpotifyIds`, and `fetchReccoBeatsIds` are intentionally Spotify-named — ReccoBeats only accepts Spotify IDs. Those are external API constraints, not platform leaks.

**Effort:** XS
**Priority:** P2 (maintainability — no user-visible impact today, but blocks clean new-platform additions)

---

## ~~A7 · Backfill platform artist ID on ArtistCache cross-platform hit~~ ✅ DONE

**What was done:** Inside `buildArtistGenreMap`, in the `normalizedName` cross-platform hit block, added a fire-and-forget `prisma.artistCache.update` that writes the requesting platform's artist ID column (`tidalArtistId`, `soundcloudArtistId`, etc.) onto the existing row when it is still null. Mirrors the identical pattern already present in `buildAudioFeaturesMap` for TrackCache. Future requests for the same artist now resolve via Strategy 1 (per-platform ID column) instead of always falling through to the slower Strategy 3 (normalizedName scan).

**File changed:** `server/src/lib/enrichment.ts`

---

## A6 · Remove legacy `artistId` column from ArtistCache

**What:** `ArtistCache.artistId` is redundant — it stores the platform-native artist ID of whichever platform first created the row, which is now also stored in the dedicated per-platform column (`spotifyArtistId`, `tidalArtistId`, `soundcloudArtistId`). The column exists only as a backward-compatibility shim for rows written before A2 added per-platform columns.

**Why:** The legacy field keeps three pieces of dead code alive: a Strategy 2 DB lookup in `buildArtistCacheOrConditions`, an extra `map[row.artistId]` index in `buildArtistGenreMap`, and an `{ artistId: id }` upsert fallback in `persistArtistGenres`. Removing it simplifies the pipeline and makes the schema self-consistent.

**What to change:**
1. **Migration** — `server/prisma/migrations/` — for every ArtistCache row, read `artistId` + `platform` and write the value into the matching platform column if that column is still null (e.g. `platform = SPOTIFY` → set `spotifyArtistId = artistId`). This backfills all pre-A2 rows.
2. `server/src/lib/enrichment.ts` — remove Strategy 2 block from `buildArtistCacheOrConditions` (lines ~94–96); remove `map[row.artistId]` from `buildArtistGenreMap` (line ~121); remove the `{ artistId: id }` fallback in `persistArtistGenres` (line ~485); remove `artistId` from the `create` payload.
3. `server/prisma/schema.prisma` — mark `artistId` as optional (`String?`) first, then drop it in a follow-up once the migration confirms no rows depend on it.

**Effort:** S
**Priority:** P2 (cleanup — no user-visible impact, but removes dead code and schema noise)
**Depends on:** A2 (already done — per-platform columns exist)

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

## A5 · Genres missing on first Tidal load — Last.fm succeeds after Spotify warms cache

**What:** Loading a Tidal playlist shows most tracks without genres. Loading the exact same tracks on Spotify populates the ArtistCache, and on the next Tidal load the cross-platform `normalizedName` lookup finds those rows and genres appear. This confirms the cache read path works — the problem is that the **initial Last.fm fetch for Tidal artists either fails silently or its results are never surfaced to the client**.

**Why:** Genres stay missing on first Tidal load. Users only see them after accidentally loading the same playlist on Spotify — a silent data gap they have no way to work around.

**What's ruled out:** Compound artist names (user confirmed Tidal shows the same single artist name as Spotify for every track — the names sent to Last.fm are identical).

**Root cause (needs investigation):** The two most likely failure points are:
1. **Last.fm returns empty for Tidal artists** — even with identical names, something in the request path could differ (e.g. Unicode normalisation, invisible characters in Tidal API responses). Add a `console.log` in `fetchLastFmArtistTags` to print the exact name string and the response before returning.
2. **Genres are persisted but the polling endpoint never surfaces them** — `persistArtistGenres` saves rows successfully, but the `/genres` polling endpoint looks up by `normalizedName`. If the `normalizedName` on the saved row doesn't match what the client sends in the poll (e.g. due to character encoding differences between the `EnrichmentTrack.artistName` and the `PlatformTrack.artist` field used by the client), the poll returns nothing. Add logging in `persistArtistGenres` to print what `normalizedName` is being saved.

**What to change:**
- `server/src/lib/enrichment.ts` — add temporary diagnostic logs in `fetchLastFmArtistTags` (print name + raw response) and in `persistArtistGenres` (print normalizedName being saved). Use the logs to confirm which failure point applies, then fix accordingly.

**Effort:** XS (diagnosis) → S (fix, once root cause is confirmed)
**Priority:** P1 (genres missing for Tidal tracks on first load — visible to users)

---

## B3 · Abort in-flight track load on navigate away

**What:** When the user navigates back to the dashboard while a playlist is still loading, the HTTP requests to the server keep running until they complete — only the React state updates are suppressed. The `cancelled` flag stops state updates but never drops the network connection.

**Why:** The server continues fetching all pages from the platform API (Tidal, Spotify) even after the user has left. On large playlists this wastes significant time and burns API rate-limit budget.

**Root cause (if known):** `usePlaylistTracks` sets `cancelled = true` in the effect cleanup but never calls `abort()` on the underlying `fetch()`. The `fetchTracksPage` function has no `signal` parameter so the browser cannot cancel the request.

**What to change:**
- `client/src/api/tracks.ts` — add optional `signal?: AbortSignal` parameter to `fetchTracksPage`; pass it to `fetch()` as `{ signal }`
- `client/src/hooks/usePlaylistTracks.ts` — create an `AbortController` inside the `useEffect`; pass `controller.signal` to all `fetchTracksPage` calls; call `controller.abort()` in the cleanup (alongside the existing `cancelled = true`); guard catch blocks against `AbortError` so intentional cancellation doesn't surface as an error state

**Effort:** S
**Priority:** P1

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

## ~~C3 · Tidal Liked Songs: pagination is fundamentally broken — ~83 tracks missing~~ ✅ SUBSTANTIALLY FIXED (3 tracks still missing — see below)

**Root cause (confirmed):**
Tidal's Liked Songs endpoint (`GET /userCollectionTracks/me/relationships/items`) sorts by `addedAt` and generates cursors from that field. When many tracks share identical `addedAt` values (bulk import), the cursor boundary is **deterministic, not random** — the same tracks are skipped on every single pass in the same sort order. `page[offset]` is silently ignored; `page[size]` does not exist in the OpenAPI spec (page size is server-hardcoded at 20 items).

**What was tried and why each approach failed:**

1. **`page[offset]`** — silently ignored, returns page 1 every time. Infinite loop.
2. **Single-pass cursor + client-side dedup** — terminates but drops ~83 tracks deterministically. Result: 411/494.
3. **Multi-pass with same sort order** — all 3 passes skip the exact same 83 tracks. Still 411/494.
4. **Server-side all-pages with no rate-limit back-off** — hit Tidal 429 before completing. Never loads.

**What worked:**
Two passes with **opposite sort orders** (`sort=-addedAt` newest-first, then `sort=addedAt` oldest-first), combined with server-side dedup across both passes. Tracks stranded at a cursor boundary in newest-first order sit in the middle of the sequence in oldest-first order and are returned normally. Recovered 80/83 missing tracks.

**Current state:** `fetchLikedTracks` runs 2 full server-side page loops before returning — one pass per sort order. Results are deduped by track ID across both passes. A 5-minute in-memory result cache (`likedTracksCache`, keyed by uid) makes repeat navigations instant. 3 tracks remain missing — they happen to sit at a cursor boundary in **both** sort orders simultaneously.

**The remaining 3 tracks:**
They are at a dense `addedAt` timestamp boundary that happens to be at a page edge in both ascending and descending order. A 3rd pass with a completely different sort key (e.g. `sort=title` or `sort=artists.name`) would shift the cursor boundaries to unrelated positions and likely recover them. Not implemented — 3/494 is an acceptable residual given the complexity cost.

**OpenAPI spec findings (from tidal-music/tidal-sdk-web on GitHub):**
- `sort` accepts: `addedAt`, `-addedAt` (default), `title`, `-title`, `artists.name`, `-artists.name`, `albums.title`, `-albums.title`, `duration`, `-duration`
- `page[cursor]` is the only pagination parameter — no offset, no page number, no page size control
- `GET /userCollectionTracks/me` (without `/relationships/items`) returns collection metadata only, not a track listing

**Files changed:** `server/src/lib/platform/tidal.ts` — `fetchLikedTracks` method

---

## B4 · Add "Remove account" button to PlatformSwitcherSidebar

**What:** The account list in the sidebar has no way to disconnect a platform account. Users who connect Tidal or SoundCloud can never remove it without manually clearing localStorage. A destructive "Remove" button is needed on each account card (except the currently active account — removing the active account should either be blocked or require switching first).

**Why:** Without this, accidentally connecting a wrong account is permanent from the user's perspective. Required before public launch.

**What to change:**
- `client/src/components/PlatformSwitcherSidebar.tsx` — add a remove button (destructive style, icon-only or small label) to each non-active account card. On click: show an inline confirmation ("Remove Tidal account?") → on confirm, call the new DELETE endpoint, remove the account from local state, and if no accounts remain redirect to `/login`.
- `server/src/routes/auth.ts` — add `DELETE /auth/:userId` route. Deletes the `User` row for the given `userId`. Returns 204. Does not affect other platform accounts for the same browser session.
- `client/src/utils/accounts.ts` — add a `removeAccount(userId)` helper that calls the DELETE route and removes the entry from localStorage.

**Effort:** S
**Priority:** P1 (required before publish — users must be able to disconnect accounts)

---

## C4 · Thread AbortSignal into PlatformAdapter.fetchPlaylistTracks

**What:** The server-side `req.on('close')` AbortController (added in C1) fires when the client drops the connection, but its signal is not passed into `adapter.fetchPlaylistTracks()`. So even when the browser cancels the request, the platform API calls (Tidal pagination loop, Spotify page fetches) keep running to completion.

**Why:** Without this, aborting on the client (B3) stops the HTTP response being delivered but doesn't stop the server from continuing to call Tidal/Spotify. On a 500-track playlist this can mean 10+ outbound API calls that no one will ever use, burning rate-limit budget.

**Root cause (if known):** `PlatformAdapter` interface has no `signal` parameter on `fetchPlaylistTracks`. The deferred note in C1 says: "doing so requires adding an optional signal parameter to the `PlatformAdapter` interface and all adapter implementations".

**What to change:**
- `server/src/lib/platform/types.ts` — add `signal?: AbortSignal` to `fetchPlaylistTracks` signature on the `PlatformAdapter` interface
- `server/src/lib/platform/spotify.ts`, `tidal.ts`, `soundcloud.ts` — accept and forward the signal to `requestWithRetry` calls inside `fetchPlaylistTracks`
- `server/src/routes/playlists.ts` — pass the existing `controller.signal` (from the `req.on('close')` controller) into `adapter.fetchPlaylistTracks()`

**Effort:** S
**Priority:** P2 (nice-to-have — B3 already fixes the user-visible symptom)
**Depends on:** B3

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
