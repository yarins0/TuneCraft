-- TrackCache redesign: replace platformTrackId + platform with
-- per-platform ID columns + ISRC for cross-platform deduplication.
-- One row now represents one unique recording, not one platform's track entry.

-- Step 1: Add the new columns (all nullable so existing rows are valid immediately)
ALTER TABLE "TrackCache" ADD COLUMN "isrc"         TEXT;
ALTER TABLE "TrackCache" ADD COLUMN "spotifyId"    TEXT;
ALTER TABLE "TrackCache" ADD COLUMN "soundcloudId" TEXT;

-- Step 2: Data migration — all existing rows were Spotify tracks.
-- Copy their platformTrackId into the new spotifyId column.
UPDATE "TrackCache" SET "spotifyId" = "platformTrackId";

-- Step 3: Drop the columns the new design replaces
ALTER TABLE "TrackCache" DROP COLUMN "platformTrackId";
ALTER TABLE "TrackCache" DROP COLUMN "platform";

-- Step 4: Create unique indexes for each platform ID column and ISRC.
-- PostgreSQL's UNIQUE INDEX treats NULLs as distinct, so nullable unique columns work correctly.
CREATE UNIQUE INDEX "TrackCache_isrc_key"         ON "TrackCache"("isrc");
CREATE UNIQUE INDEX "TrackCache_spotifyId_key"    ON "TrackCache"("spotifyId");
CREATE UNIQUE INDEX "TrackCache_soundcloudId_key" ON "TrackCache"("soundcloudId");
