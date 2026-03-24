-- TrackCache redesign: replace the single spotifyId + platform columns with
-- per-platform ID columns + ISRC for cross-platform deduplication.
-- One row now represents one unique recording, not one platform's track entry.

-- Step 1: Make spotifyId nullable — it was NOT NULL in the initial schema
-- but the new design allows a row to exist before all platform IDs are resolved.
ALTER TABLE "TrackCache" ALTER COLUMN "spotifyId" DROP NOT NULL;

-- Step 2: Add the new cross-platform columns (all nullable so existing rows are valid immediately).
ALTER TABLE "TrackCache" ADD COLUMN IF NOT EXISTS "isrc"         TEXT;
ALTER TABLE "TrackCache" ADD COLUMN IF NOT EXISTS "soundcloudId" TEXT;

-- Step 3: Drop the platform column — replaced by per-platform ID columns.
ALTER TABLE "TrackCache" DROP COLUMN IF EXISTS "platform";

-- Step 4: Create unique indexes for the new columns.
-- TrackCache_spotifyId_key already exists from the initial migration — skip it.
CREATE UNIQUE INDEX IF NOT EXISTS "TrackCache_isrc_key"         ON "TrackCache"("isrc");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackCache_soundcloudId_key" ON "TrackCache"("soundcloudId");
