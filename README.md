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
├── client/          # React frontend (Vite)
│   └── src/
│       ├── components/   # Reusable UI components
│       └── pages/        # Route-level page components
└── server/          # Express backend
    └── src/
        ├── lib/          # Shuffle algorithms, cron job, Prisma client
        ├── middleware/   # Token refresh middleware
        └── routes/       # API route handlers
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

---

## Roadmap

See [TUNECRAFT_ROADMAP.md](./TUNECRAFT_ROADMAP.md) for the full feature roadmap, current progress, and technical notes.
