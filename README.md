# TuneCraft

> Smarter Spotify playlist management. Analyze, shuffle, organize, and automate your music library beyond what Spotify natively offers.

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
                             PlatformAdapter    Prisma ORM
                             (Spotify impl)       │
                                    │         PostgreSQL
                               Spotify API
                               Last.fm API
                               ReccoBeats API
```

All playlist and reshuffle routes run through `server/src/middleware/refreshToken.ts`, which auto-refreshes expired Spotify tokens and attaches the valid access token to `req` before any route handler runs.

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
  ┌───────────────────────────────────────┐
  │           Audio Features              │
  │                                       │
  │  Check TrackCache (by spotifyId)      │
  │       ├── HIT  → use cached data      │
  │       └── MISS → batch collect IDs   │
  │                       │              │
  │             ReccoBeats API            │
  │          (batches of ≤ 40 tracks)     │
  │                       │              │
  │             Persist to TrackCache     │
  └───────────────────────────────────────┘
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
  │             Persist to ArtistCache    │
  └───────────────────────────────────────┘
          │
          ▼
  Merge audioFeatures + genres onto each track object
          │
          ▼
  Return enriched tracks to client
```

**Why two caches?** Audio features are keyed per track (stable — a song's BPM doesn't change). Genres are keyed per artist (one artist → many tracks; caching at the artist level avoids redundant Last.fm calls).

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

| File | Used by |
|---|---|
| `server/src/lib/shuffleAlgorithms.ts` | Shuffle route, auto-reshuffle cron |
| `client/src/utils/shuffleAlgorithms.ts` | UI preview (instant, no API call) |

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
                                                   Write order to Spotify
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
       └──▶  getAdapter(platform)          ← resolves 'spotify' → SpotifyAdapter
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
          SpotifyAdapter (concrete impl)
          server/src/lib/platform/spotify.ts
```

Adding a new platform (Apple Music, YouTube Music) means implementing `PlatformAdapter` and registering it in `registry.ts` — zero changes to route handlers.

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
      fetches new tokens from Spotify if needed,
      attaches fresh access token to req.spotifyToken
```

`localStorage` is used (not `sessionStorage`) so that authentication persists across multiple browser tabs opened from the same origin.

---

### Rate Limiting

Spotify enforces a 429 rate limit. `spotifyRequestWithRetry` in `routes/playlists.ts` handles this transparently:

1. Make the request
2. If 429 → read `Retry-After` header (default 5s, max 30s)
3. Retry up to 3 times
4. On third failure, propagate the error

---

## Database Schema

```
┌─────────────────────────────────────────┐
│                  User                   │
│─────────────────────────────────────────│
│ id                String  (cuid, PK)    │
│ spotifyUserId     String  (unique)      │
│ accessToken       String                │
│ refreshToken      String                │
│ tokenExpiresAt    DateTime              │
│ createdAt         DateTime              │
└──────────────────────┬──────────────────┘
                       │ 1:N
                       ▼
┌─────────────────────────────────────────┐
│               Playlist                  │
│─────────────────────────────────────────│
│ id                  String  (cuid, PK)  │
│ userId              String  (FK → User) │
│ platformPlaylistId  String  (Spotify ID)│
│ autoReshuffle       Boolean             │
│ intervalDays        Int?                │
│ algorithms          Json?               │
│ lastReshuffledAt    DateTime?           │
│ nextReshuffleAt     DateTime?           │
│ @@unique([userId, platformPlaylistId])  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│              TrackCache                 │
│─────────────────────────────────────────│
│ spotifyId      String  (unique, PK)     │
│ audioFeatures  Json                     │
│ fetchedAt      DateTime                 │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│              ArtistCache                │
│─────────────────────────────────────────│
│ artistId   String  (unique, PK)         │
│ genres     Json    (string[])           │
│ fetchedAt  DateTime                     │
└─────────────────────────────────────────┘
```

`Playlist` stores only scheduling metadata — track data is never persisted locally. It is always fetched live from Spotify and enriched on the fly via the two cache tables.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Auth | Spotify OAuth 2.0 with automatic token refresh |
| External APIs | Spotify Web API, Last.fm, ReccoBeats |
| Background jobs | node-cron |

---

## Prerequisites

- **Node.js** — latest LTS recommended
- **PostgreSQL** — local or hosted instance
- **Spotify Developer App** — create one at [developer.spotify.com](https://developer.spotify.com/dashboard). You will need a Client ID, Client Secret, and a configured redirect URI
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
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_SECRET=your_lastfm_secret
RECCOBEATS_API_KEY=your_reccobeats_api_key
REDIRECT_URI=http://127.0.0.1:3000/auth/callback
FRONTEND_URL=http://127.0.0.1:5173
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
PORT=3000
```

> **Important:** `REDIRECT_URI` must exactly match the redirect URI registered in your Spotify Developer Dashboard.

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

| Process | URL |
|---|---|
| Backend API | `http://127.0.0.1:3000` |
| Frontend | `http://127.0.0.1:5173` |
| Prisma Studio | launched automatically |

Health check: `GET http://127.0.0.1:3000/health`

---

## Project Structure

```
tunecraft/
├── client/                        # React frontend (Vite + TypeScript)
│   └── src/
│       ├── api/                   # Typed fetch wrappers (playlists, tracks, reshuffle)
│       ├── components/            # Modals (Shuffle, Split, Merge, Copy, Duplicates)
│       ├── constants/             # Audio feature keys, labels, chart colours
│       ├── hooks/                 # useAnimatedLabel (cycling button state text)
│       ├── pages/                 # Route-level components (Login, Dashboard, PlaylistDetail, Callback)
│       └── utils/                 # shuffleAlgorithms, splitPlaylist, mergePlaylists, platform helpers
└── server/                        # Express backend (Node.js + TypeScript)
    └── src/
        ├── lib/
        │   ├── crons/             # Auto-reshuffle cron job
        │   ├── platform/          # PlatformAdapter interface, SpotifyAdapter, registry
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
| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login` | Redirects to Spotify OAuth |
| `GET` | `/auth/callback` | Handles Spotify redirect, upserts user, redirects to frontend |

### Playlists
| Method | Path | Description |
|---|---|---|
| `GET` | `/playlists/:userId` | List all playlists for user (owned + following) |
| `GET` | `/playlists/:userId/:playlistId/tracks` | Get enriched tracks for a playlist |
| `PUT` | `/playlists/:userId/:playlistId/save` | Persist a new track order to Spotify |
| `POST` | `/playlists/:userId/:playlistId/shuffle` | Shuffle and save to Spotify |
| `POST` | `/playlists/:userId/:playlistId/split` | Create multiple new playlists from grouped tracks |
| `POST` | `/playlists/:userId/merge` | Merge tracks from multiple playlists into one |
| `POST` | `/playlists/:userId/copy` | Copy a playlist to the user's library |
| `GET` | `/playlists/:userId/discover` | Fetch and enrich any public playlist by URL |

### Reshuffle Schedule
| Method | Path | Description |
|---|---|---|
| `POST` | `/reshuffle/:userId/:playlistId/schedule` | Create or update an auto-reshuffle schedule |
| `DELETE` | `/reshuffle/:userId/:playlistId/schedule` | Remove an auto-reshuffle schedule |
| `GET` | `/reshuffle/:userId/:playlistId/schedule` | Get current schedule for a playlist |

---

## Roadmap

See [TUNECRAFT_ROADMAP.md](./TUNECRAFT_ROADMAP.md) for the full feature roadmap, current progress, and technical notes.
