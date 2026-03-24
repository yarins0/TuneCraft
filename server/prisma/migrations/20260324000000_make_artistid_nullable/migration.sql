-- Add per-platform artist ID columns and normalizedName to ArtistCache.
-- These were originally added via db push without a migration — added here so the
-- migration chain replays correctly on a clean database.
ALTER TABLE "ArtistCache" ADD COLUMN IF NOT EXISTS "normalizedName"      TEXT;
ALTER TABLE "ArtistCache" ADD COLUMN IF NOT EXISTS "spotifyArtistId"     TEXT;
ALTER TABLE "ArtistCache" ADD COLUMN IF NOT EXISTS "tidalArtistId"       TEXT;
ALTER TABLE "ArtistCache" ADD COLUMN IF NOT EXISTS "soundcloudArtistId"  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ArtistCache_normalizedName_key"     ON "ArtistCache"("normalizedName");
CREATE UNIQUE INDEX IF NOT EXISTS "ArtistCache_spotifyArtistId_key"    ON "ArtistCache"("spotifyArtistId");
CREATE UNIQUE INDEX IF NOT EXISTS "ArtistCache_tidalArtistId_key"      ON "ArtistCache"("tidalArtistId");
CREATE UNIQUE INDEX IF NOT EXISTS "ArtistCache_soundcloudArtistId_key" ON "ArtistCache"("soundcloudArtistId");

-- Make ArtistCache.artistId nullable.
-- The legacy artistId column was the original single artist ID field. Per-platform columns
-- now handle per-platform storage. artistId is kept for backward compatibility but is no
-- longer written by new code. Making it nullable allows new rows to be created without it.
ALTER TABLE "ArtistCache" ALTER COLUMN "artistId" DROP NOT NULL;

-- Data migration: backfill per-platform columns from artistId where they are still null.
-- Existing rows were written before per-platform columns existed, so artistId holds what
-- is now the platform-specific value.

-- Spotify rows: artistId → spotifyArtistId
UPDATE "ArtistCache"
SET "spotifyArtistId" = "artistId"
WHERE "platform" = 'SPOTIFY'
  AND "artistId" IS NOT NULL
  AND "spotifyArtistId" IS NULL;

-- SoundCloud rows: artistId → soundcloudArtistId
UPDATE "ArtistCache"
SET "soundcloudArtistId" = "artistId"
WHERE "platform" = 'SOUNDCLOUD'
  AND "artistId" IS NOT NULL
  AND "soundcloudArtistId" IS NULL;

-- Tidal rows: artistId → tidalArtistId
UPDATE "ArtistCache"
SET "tidalArtistId" = "artistId"
WHERE "platform" = 'TIDAL'
  AND "artistId" IS NOT NULL
  AND "tidalArtistId" IS NULL;
