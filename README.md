# Tunecraft

Tunecraft is a full-stack app for smarter Spotify playlist control: analyze tracks (audio features + genres), apply composable shuffle algorithms, and optionally auto-reshuffle playlists on a schedule.

## Tech stack

- **Client**: React + TypeScript + Vite
- **Server**: Node.js + Express + TypeScript
- **DB**: PostgreSQL via Prisma
- **Integrations**: Spotify OAuth + Spotify Web API, Last.fm (genres), ReccoBeats (audio features)

## Prerequisites

- **Node.js** (recommended: latest LTS)
- **PostgreSQL** database (local or hosted)
- **Spotify Developer App** (Client ID/Secret + redirect URI)
- **Last.fm API key/secret**

## Repo layout

- `client/`: frontend (Vite dev server)
- `server/`: backend API + Prisma + cron-based auto-reshuffle

## Setup

1) Install dependencies:

```bash
npm install
```

2) Configure environment variables:

- Copy `server/.env.example` → `server/.env`
- Fill in values, and add **DATABASE_URL** (required by Prisma)

Example (`server/.env`):

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
LASTFM_API_KEY=...
LASTFM_SECRET=...
REDIRECT_URI=http://127.0.0.1:3000/auth/callback
FRONTEND_URL=http://127.0.0.1:5173
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
PORT=3000
```

3) Initialize the database (from `server/`):

```bash
cd server
npx prisma generate
npx prisma migrate dev
```

## Run locally

From the repo root:

```bash
npm run dev
```

This starts:

- **Server**: `http://127.0.0.1:3000`
- **Client**: `http://127.0.0.1:5173`
- **Prisma Studio**: launches via `npx prisma studio` (from `server/`)

Health check:

- `GET /health` → `http://127.0.0.1:3000/health`

## Useful scripts

From repo root:

- **dev**: runs client + server + Prisma Studio concurrently (`npm run dev`)

From `server/`:

- **dev**: `npm run dev` (nodemon + ts-node)
- **build**: `npm run build` (TypeScript compile)
- **start**: `npm start` (runs `dist/`)

From `client/`:

- **dev**: `npm run dev`
- **build**: `npm run build`
- **lint**: `npm run lint`
- **preview**: `npm run preview`

## Notes

- **OAuth redirect**: `REDIRECT_URI` must match the redirect URI configured in your Spotify Developer Dashboard.
- **Auto-reshuffle**: the server starts a cron task on boot (see `server/src/lib/reshuffleCron.ts`) to process due playlists.

## Roadmap

See `TUNECRAFT_ROADMAP.md`.

