/*
  Warnings:

  - You are about to drop the column `artistId` on the `ArtistCache` table. All the data in the column will be lost.
  - You are about to drop the column `spotifyPlaylistId` on the `Playlist` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[youtubeArtistId]` on the table `ArtistCache` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,platformPlaylistId]` on the table `Playlist` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[youtubeId]` on the table `TrackCache` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[platformUserId,platform]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `platformPlaylistId` to the `Playlist` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'YOUTUBE';

-- DropIndex
DROP INDEX "ArtistCache_artistId_key";

-- DropIndex
DROP INDEX "Playlist_userId_spotifyPlaylistId_key";

-- DropIndex
DROP INDEX "User_platformUserId_key";

-- AlterTable
ALTER TABLE "ArtistCache" DROP COLUMN "artistId",
ADD COLUMN     "youtubeArtistId" TEXT;

-- AlterTable
ALTER TABLE "Playlist" DROP COLUMN "spotifyPlaylistId",
ADD COLUMN     "platformPlaylistId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TrackCache" ADD COLUMN     "youtubeId" TEXT;

-- CreateTable
CREATE TABLE "SpotifyAccessRequest" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotifyAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistCache_youtubeArtistId_key" ON "ArtistCache"("youtubeArtistId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_userId_platformPlaylistId_key" ON "Playlist"("userId", "platformPlaylistId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackCache_youtubeId_key" ON "TrackCache"("youtubeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_platformUserId_platform_key" ON "User"("platformUserId", "platform");
