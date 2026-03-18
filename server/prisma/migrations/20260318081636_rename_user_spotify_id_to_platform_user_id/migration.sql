-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('SPOTIFY', 'SOUNDCLOUD', 'APPLE_MUSIC');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'SPOTIFY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "spotifyPlaylistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "autoReshuffle" BOOLEAN NOT NULL DEFAULT false,
    "intervalDays" INTEGER,
    "algorithms" JSONB,
    "lastReshuffledAt" TIMESTAMP(3),
    "nextReshuffleAt" TIMESTAMP(3),
    "platform" "Platform" NOT NULL DEFAULT 'SPOTIFY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackCache" (
    "id" TEXT NOT NULL,
    "spotifyId" TEXT NOT NULL,
    "audioFeatures" JSONB NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'SPOTIFY',
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistCache" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "genres" JSONB NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'SPOTIFY',
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_platformUserId_key" ON "User"("platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_userId_spotifyPlaylistId_key" ON "Playlist"("userId", "spotifyPlaylistId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackCache_spotifyId_key" ON "TrackCache"("spotifyId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistCache_artistId_key" ON "ArtistCache"("artistId");

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
