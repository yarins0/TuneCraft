-- Add TIDAL to the Platform enum
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'TIDAL';

-- Add tidalId column to TrackCache.
-- One column per platform — same pattern as spotifyId and soundcloudId.
-- Nullable and unique: NULL means the recording hasn't been linked to a Tidal track yet.
ALTER TABLE "TrackCache" ADD COLUMN IF NOT EXISTS "tidalId" TEXT;

-- Unique index so ISRC cross-platform lookups can backfill tidalId without duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "TrackCache_tidalId_key" ON "TrackCache"("tidalId");
