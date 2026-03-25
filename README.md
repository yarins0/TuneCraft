# TuneCraft

>Smarter playlist management. Analyze, shuffle, organize, and automate your music library.

---

## Features

### Smart Shuffle
Apply composable shuffle algorithms to any playlist before saving:

- **True Random** — Fisher-Yates equal-probability shuffle
- **Artist Spread** — no two tracks by the same artist play back-to-back
- **Genre Spread** — groups similar genres together for smoother listening flow
- **Chronological Mix** — interleaves tracks from different eras

Algorithms are composable — combine Genre Spread + Artist Spread in a single pass.

### Auto-Reshuffle
Set a playlist to automatically reshuffle on a daily, weekly, or monthly schedule. A background cron job handles reshuffling server-side without any manual action.

### Playlist Organizer
- **Merge** — combine multiple playlists into one, with optional duplicate removal
- **Split** — divide a playlist by genre, artist, era/decade, or audio feature (energy, danceability, valence, tempo, and more). Preview, rename, and rearrange groups before saving
- **Duplicate Finder** — scan a playlist for duplicate tracks and remove them inline

### Track Analysis
Every track is enriched with:
- **Audio features** — energy, danceability, valence, tempo, acousticness, instrumentalness, speechiness (via ReccoBeats)
- **Genres** — artist-level genre tags (via Last.fm)
- Visualized as donut charts on the playlist detail page

### Playlist Discovery
Paste any public Spotify playlist URL to open and analyze it, even if it's not in your library.

---

## Architecture

### System Overview

```
Browser → Vite (5173) → React Router → Page component
                                           │
                                   src/api/*.ts  ← typed fetch wrappers
                                           │
                         Express server (3000)
                                           │
                              refreshTokenMiddleware
                              (attaches valid access token)
                                           │
                         ┌─────────────────┴──────────────────┐
                         │           Route Handlers           │
                         │  auth.ts │ playlists.ts │ reshuffle │
                         └──────────┬──────────────┬──────────┘
                                    │              │
                         PlatformAdapter         Prisma ORM
                   (Spotify / SoundCloud / Tidal)   │
                                    │         PostgreSQL
                               Platform API
                               Last.fm API
                               ReccoBeats API
```

All playlist and reshuffle routes run through `server/src/middleware/refreshToken.ts`, which auto-refreshes expired tokens and attaches the valid access token to `req` before any route handler runs.

---

### Track Enrichment Pipeline

Spotify's API returns track metadata (name, artist, album) but no audio analysis or genre data. TuneCraft enriches every track on the way out:

```
GET /playlists/:userId/:playlistId/tracks
          │
          ▼
  Fetch raw tracks from Spotify
          │
          ▼
  ┌────────────────────────────────────────────┐
  │              Audio Features                │
  │                                            │
  │  Check TrackCache (spotifyId / soundcloud  │
  │  Id / isrc — one OR query, all platforms)  │
  │       ├── HIT  → use cached data           │
  │       │    └─ ISRC cross-hit? backfill      │
  │       │       platform ID fire-and-forget  │
  │       └── MISS → Phase 0: ISRC → spotifyId │
  │                  (SoundCloud only)         │
  │                       │                   │
  │             ReccoBeats API                 │
  │          (batches of ≤ 40 tracks)          │
  │                       │                   │
  │             Upsert TrackCache by ISRC      │
  │             (links both platform IDs       │
  │              to a single row)              │
  └────────────────────────────────────────────┘
          │
          ▼
  ┌───────────────────────────────────────┐
  │              Genres                   │
  │                                       │
  │  Check ArtistCache (by artistId)      │
  │       ├── HIT  → use cached tags      │
  │       └── MISS → fetch per artist    │
  │                       │              │
  │              Last.fm API              │
  │          (artist.getTopTags)          │
  │                       │              │
  │   genres empty? → skip cache         │
  │   genres present? → persist          │
  │             to ArtistCache           │
  └───────────────────────────────────────┘
          │
          ▼
  Merge audioFeatures + genres onto each track object
          │
          ▼
  Return enriched tracks to client
```

**Why two caches?** Audio features are keyed per track (stable — a song's BPM doesn't change). Genres are keyed per artist (one artist → many tracks; caching at the artist level avoids redundant Last.fm calls).

**Cache write policy:**

|                           | TrackCache                                          | ArtistCache                                                      |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| API error / 429           | Not cached — retried on next request                | Not cached — retried on next request                             |
| Empty response (no data)  | Cached — TTL will trigger a fresh fetch in 90 days  | Not cached — retried on every request until Last.fm returns tags |
| Response with data        | Cached                                              | Cached                                                           |

The asymmetry is intentional: audio features are stable and unlikely to appear after a 200 with no data, so caching the empty response avoids hammering ReccoBeats. Genre tags can be added to Last.fm at any time, so an empty response is never written to the cache — the next request always gets a fresh attempt.

**Cross-platform deduplication:** `TrackCache` holds one row per unique recording, not one row per platform track entry. The row is keyed by ISRC when available, so if a song is loaded on Spotify first and later on SoundCloud, ReccoBeats is never called a second time — the existing features are returned immediately and the SoundCloud ID is backfilled onto the existing row.

|                            | TrackCache                                                                                                                                                              | ArtistCache                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cross-platform read hit    | Found via `isrc` in the OR query                                                                                                                                        | Found via `normalizedName` (lowercase artist name)                                                   |
| Backfill native ID on hit  | `tidalId` / `soundcloudId` written to row fire-and-forget                                                                                                               | `tidalArtistId` / `soundcloudArtistId` written to row fire-and-forget                                |
| Secondary cache check      | After ISRC → Spotify ID resolution, re-checks DB by `spotifyId` before calling ReccoBeats — avoids a redundant API call when a Spotify-sourced row exists without an ISRC | N/A — `normalizedName` covers the cross-platform hit on the initial read; no secondary check needed  |
| Write collision handling   | If a `spotifyId` row exists without an ISRC and a new ISRC resolves to that same ID, the ISRC is merged onto the existing row rather than creating a duplicate           | N/A — upsert key is `normalizedName`; the same artist from two platforms always lands on one row     |

**ReccoBeats batch cap:** The API accepts up to 40 track IDs per request. Requests are split into chunks of 40 before dispatch.

**Prisma JSON columns:** `audioFeatures` is stored as JSON. After retrieval it may deserialize as a string. All consumers guard with:
```ts
typeof f === 'string' ? JSON.parse(f) : f
```

---

### Shuffle Algorithm Pipeline

`applyShuffle()` applies enabled algorithms in a **fixed order**. Order matters — Artist Spread after Genre Spread produces different results than the reverse.

```
Input tracks array
       │
       ▼
  ┌──────────────────────────────────────┐
  │  1. Chronological Mix (if enabled)   │
  │     Sort by release year,            │
  │     then interleave eras evenly      │
  └──────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────┐
  │  2. Genre Spread (if enabled)        │
  │     Group tracks by genre,           │
  │     round-robin across groups        │
  └──────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────┐
  │  3. Artist Spread (if enabled)       │
  │     Ensure no adjacent same-artist   │
  │     pairs using gap insertion        │
  └──────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────┐
  │  4. True Random (mutually exclusive) │
  │     Fisher-Yates in-place shuffle    │
  │     (skipped if any above enabled)   │
  └──────────────────────────────────────┘
       │
       ▼
  Output shuffled tracks array
```

**Two identical copies exist** — one server-side for actual saves and the cron job, one client-side for instant preview before the user commits:

| File                                    | Used by                            |
| --------------------------------------- | ---------------------------------- |
| `server/src/lib/shuffleAlgorithms.ts`   | Shuffle route, auto-reshuffle cron |
| `client/src/utils/shuffleAlgorithms.ts` | UI preview (instant, no API call)  |

---

### Auto-Reshuffle System

```
  node-cron  ──── runs every hour (0 * * * *) ────▶  reshuffleCron.ts
                                                             │
                                                   Query Playlist table:
                                              autoReshuffle = true AND
                                              nextReshuffleAt ≤ NOW
                                                             │
                                              For each matching playlist:
                                                             │
                                                   ┌─────────┴──────────┐
                                                   │                    │
                                           fetchAllTracksMeta     applyShuffle()
                                           (Spotify, no          (stored algorithm
                                            enrichment)           settings)
                                                   │                    │
                                                   └─────────┬──────────┘
                                                             │
                                                   Write order to platform
                                                   via PlatformAdapter
                                                             │
                                                   Update DB:
                                                   lastReshuffledAt = now
                                                   nextReshuffleAt = now + intervalDays
                                                             │
                                                   Spotify 404?
                                                   → Delete orphaned schedule
```

`lastReshuffledAt` is **only** written by:
1. The shuffle route (manual shuffle + save)
2. The save route (manual track reorder + save with active schedule)
3. The auto-reshuffle cron

The schedule upsert route (`POST /reshuffle/schedule`) intentionally does **not** set `lastReshuffledAt` — creating or updating a schedule is not a shuffle event.

---

### Platform Adapter Pattern

All Spotify-specific code lives behind an interface. Routes never call Spotify directly:

```
routes/playlists.ts
       │
       └──▶  getAdapter(platform)          ← resolves 'spotify' → SpotifyAdapter, 'tidal' → TidalAdapter, etc.
                     │
                     ▼
          PlatformAdapter interface
          ┌─────────────────────────────┐
          │ getPlaylists(userId)         │
          │ getTracks(userId, id)        │
          │ updateTrackOrder(...)        │
          │ createPlaylist(...)          │
          │ addTracks(...)               │
          └─────────────────────────────┘
                     │
                     ▼
          SpotifyAdapter / TidalAdapter / SoundCloudAdapter
          server/src/lib/platform/{spotify,tidal,soundcloud}.ts
```

Adding a new platform means implementing `PlatformAdapter` and registering it in `registry.ts` — zero changes to route handlers. `TrackCache` already has a dedicated column for each platform (`spotifyId`, `soundcloudId`, `tidalId`) — add a new column per platform as adapters are built. Tidal (`TidalAdapter`) is fully implemented alongside Spotify and SoundCloud.

---

### Authentication Flow

```
  User clicks "Login with Spotify"
          │
          ▼
  GET /auth/login  → redirects to Spotify OAuth
          │
  User grants permission on Spotify
          │
          ▼
  GET /auth/callback  (Spotify redirects here)
  ├── Exchange code for access + refresh tokens
  ├── Upsert User record in DB (cuid as internal ID)
  └── Redirect to frontend /callback?userId=...&platformUserId=...
          │
          ▼
  Callback.tsx reads URL params
  ├── localStorage.setItem('userId', ...)         ← internal DB cuid
  └── localStorage.setItem('platformUserId', ...) ← Spotify user ID
          │
          ▼
  Navigate to /dashboard

  Every subsequent API call:
  ├── Passes userId in URL: /playlists/:userId/...
  └── refreshTokenMiddleware checks token expiry,
      fetches new tokens from the platform if needed,
      attaches fresh access token to req.platformToken
```

`localStorage` is used (not `sessionStorage`) so that authentication persists across multiple browser tabs opened from the same origin.

---

### Rate Limiting

All platform APIs enforce rate limits. `requestWithRetry` in `server/src/lib/requestWithRetry.ts` handles this transparently across every adapter:

1. Make the request
2. If 429 → read `Retry-After` header (default 5s, floored at 1s, capped at 120s)
3. Retry up to 3 times
4. On third failure, propagate the error

The 1s floor prevents APIs that send `Retry-After: 0` from burning all retry attempts with back-to-back requests inside the same rate-limit window.

---

## Database Schema

```
┌─────────────────────────────────────────┐
│                  User                   │
│─────────────────────────────────────────│
│ id                String  (cuid, PK)    │
│ platformUserId    String                │
│ displayName       String                │
│ email             String?               │
│ accessToken       String                │
│ refreshToken      String                │
│ tokenExpiresAt    DateTime              │
│ platform          Platform (enum)       │
│ createdAt         DateTime              │
│ @@unique([platformUserId, platform])    │
└──────────────────────┬──────────────────┘
                       │ 1:N
                       ▼
┌─────────────────────────────────────────┐
│               Playlist                  │
│─────────────────────────────────────────│
│ id                  String  (cuid, PK)  │
│ userId              String  (FK → User) │
│ platformPlaylistId  String              │
│ name                String              │
│ autoReshuffle       Boolean             │
│ intervalDays        Int?                │
│ algorithms          Json?               │
│ lastReshuffledAt    DateTime?           │
│ nextReshuffleAt     DateTime?           │
│ platform            Platform (enum)     │
│ @@unique([userId, platformPlaylistId])  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│              TrackCache                 │
│─────────────────────────────────────────│
│ id            String   (cuid, PK)       │
│ isrc          String?  (unique)         │
│ spotifyId     String?  (unique)         │
│ soundcloudId  String?  (unique)         │
│ tidalId       String?  (unique)         │
│ audioFeatures Json                      │
│ cachedAt      DateTime                  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│              ArtistCache                │
│─────────────────────────────────────────│
│ id                  String  (cuid, PK)  │
│ artistId            String  (unique)    │
│ artistName          String              │
│ normalizedName      String? (unique)    │
│ spotifyArtistId     String? (unique)    │
│ tidalArtistId       String? (unique)    │
│ soundcloudArtistId  String? (unique)    │
│ genres              Json    (string[])  │
│ platform            Platform (enum)     │
│ cachedAt            DateTime            │
└─────────────────────────────────────────┘
```

`Playlist` stores only scheduling metadata — track data is never persisted locally. It is always fetched live from the platform and enriched on the fly via the two cache tables.

`TrackCache` holds one row per unique recording. The same song on Spotify and SoundCloud shares a single row, linked by ISRC. Platform-specific ID columns (`spotifyId`, `soundcloudId`) are added as each adapter is built.

---

## Tech Stack

| Layer           | Technology                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| Frontend        | React, TypeScript, Vite, Tailwind CSS                                        |
| Backend         | Node.js, Express, TypeScript                                                 |
| Database        | PostgreSQL via Prisma ORM                                                    |
| Auth            | Spotify OAuth 2.0 with automatic token refresh                               |
| External APIs   | Spotify Web API, SoundCloud API, Tidal API (OpenAPI v2), Last.fm, ReccoBeats |
| Background jobs | node-cron                                                                    |

---

## Prerequisites

- **Node.js** — latest LTS recommended
- **PostgreSQL** — local or hosted instance
- **Spotify Developer App** — create one at [developer.spotify.com](https://developer.spotify.com/dashboard). You will need a Client ID, Client Secret, and a configured redirect URI
- **Tidal Developer App** — register at [developer.tidal.com](https://developer.tidal.com). Uses PKCE OAuth 2.0; requires `user.read`, `collection.read`, `collection.write`, `playlists.read`, `playlists.write` scopes
- **Last.fm API key** — register at [last.fm/api](https://www.last.fm/api/account/create)
- **ReccoBeats API key** — for audio features (replaces Spotify's deprecated audio features endpoint)

---

## Setup

### 1. Install dependencies

From the repo root:

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp server/.env.example server/.env
```

`server/.env`:

```env
# Base URL of this server — redirect URIs for all platforms are derived from it.
# Dev: http://127.0.0.1:3000  |  Prod: https://your-api-domain.com
SERVER_URL=http://127.0.0.1:3000

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

SOUNDCLOUD_CLIENT_ID=your_soundcloud_client_id
SOUNDCLOUD_CLIENT_SECRET=your_soundcloud_client_secret

TIDAL_CLIENT_ID=your_tidal_client_id
TIDAL_CLIENT_SECRET=your_tidal_client_secret

LASTFM_API_KEY=your_lastfm_api_key
LASTFM_SECRET=your_lastfm_secret

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
DIRECT_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public

FRONTEND_URL=http://127.0.0.1:5173
PORT=3000
```

> **Important:** `SPOTIFY_REDIRECT_URI` must exactly match the redirect URI registered in your Spotify Developer Dashboard.

### 3. Initialize the database

```bash
cd server
npx prisma generate
npx prisma migrate dev
```

---

## Running Locally

From the repo root:

```bash
npm run dev
```

This starts all three processes concurrently:

| Process       | URL                       |
| ------------- | ------------------------- |
| Backend API   | `http://127.0.0.1:3000`   |
| Frontend      | `http://127.0.0.1:5173`   |
| Prisma Studio | launched automatically    |

Health check: `GET http://127.0.0.1:3000/health`

---

## Project Structure

```
tunecraft/
├── client/                        # React frontend (Vite + TypeScript)
│   └── src/
│       ├── api/                   # Typed fetch wrappers (playlists, tracks, reshuffle)
│       ├── components/            # Modals (Shuffle, Split, Merge, Copy, Duplicates), AppFooter, PlatformSwitcherSidebar
│       ├── constants/             # Audio feature keys, labels, chart colours
│       ├── hooks/                 # useAnimatedLabel, usePlaylistTracks, usePlaylistActions, useReshuffleSchedule
│       ├── pages/                 # Route-level components (Login, Dashboard, PlaylistDetail, Contact, PrivacyPolicy, Callback)
│       └── utils/                 # shuffleAlgorithms, splitPlaylist, mergePlaylists, platform helpers
└── server/                        # Express backend (Node.js + TypeScript)
    └── src/
        ├── lib/
        │   ├── crons/             # Auto-reshuffle cron job
        │   ├── platform/          # PlatformAdapter interface, SpotifyAdapter, TidalAdapter, SoundCloudAdapter, registry
        │   └── shuffleAlgorithms.ts
        ├── middleware/            # refreshToken.ts — transparent token refresh
        └── routes/                # auth.ts, playlists.ts, reshuffle.ts, tracks.ts
```

---

## Available Scripts

**Repo root:**
```bash
npm run dev        # Start client + server + Prisma Studio concurrently
```

**`server/`:**
```bash
npm run dev        # Start server with hot reload (ts-node + nodemon)
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled dist/
```

**`client/`:**
```bash
npm run dev        # Start Vite dev server
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build locally
```

**Database (`server/`):**
```bash
npx prisma generate       # Regenerate PrismaClient after schema changes
npx prisma migrate dev    # Apply migrations in development
npx prisma studio         # Open DB GUI
```

---

## API Reference

All routes are prefixed with the Express base path. The `userId` segment is the internal DB cuid stored in `localStorage` after login.

### Auth
| Method | Path                                              | Description                                                          |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/auth/login?platform=SPOTIFY\|TIDAL\|SOUNDCLOUD` | Redirects to the appropriate platform OAuth / PKCE flow              |
| `GET`  | `/auth/spotify/callback`                          | Handles Spotify OAuth redirect, upserts user, redirects to frontend  |
| `GET`  | `/auth/tidal/callback`                            | Handles Tidal PKCE callback, exchanges code + verifier, upserts user |
| `GET`  | `/auth/soundcloud/callback`                       | Handles SoundCloud OAuth redirect, upserts user, redirects to frontend |

### Playlists
| Method | Path                                       | Description                                       |
| ------ | ------------------------------------------ | ------------------------------------------------- |
| `GET`  | `/playlists/:userId`                       | List all playlists for user (owned + following)   |
| `GET`  | `/playlists/:userId/:playlistId/tracks`    | Get enriched tracks for a playlist                |
| `PUT`  | `/playlists/:userId/:playlistId/save`      | Persist a new track order to Spotify              |
| `POST` | `/playlists/:userId/:playlistId/shuffle`   | Shuffle and save to Spotify                       |
| `POST` | `/playlists/:userId/:playlistId/split`     | Create multiple new playlists from grouped tracks |
| `POST` | `/playlists/:userId/merge`                 | Merge tracks from multiple playlists into one     |
| `POST` | `/playlists/:userId/copy`                  | Copy a playlist to the user's library             |
| `GET`  | `/playlists/:userId/discover`              | Fetch and enrich any public playlist by URL       |

### Reshuffle Schedule
| Method   | Path                                      | Description                                  |
| -------- | ----------------------------------------- | -------------------------------------------- |
| `POST`   | `/reshuffle/:userId/:playlistId/schedule` | Create or update an auto-reshuffle schedule  |
| `DELETE` | `/reshuffle/:userId/:playlistId/schedule` | Remove an auto-reshuffle schedule            |
| `GET`    | `/reshuffle/:userId/:playlistId/schedule` | Get current schedule for a playlist         |

---

## Roadmap

See [TUNECRAFT_ROADMAP.md](./TUNECRAFT_ROADMAP.md) for the full feature roadmap, current progress, and technical notes.
