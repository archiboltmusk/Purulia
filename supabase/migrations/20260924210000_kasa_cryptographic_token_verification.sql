-- Migration: Add cryptographic photo binding and EXIF GPS verification
-- This migration adds:
-- 1. Capture token tracking to prevent photo spoofing
-- 2. EXIF GPS data extraction and verification

BEGIN;

-- Table to track used capture tokens (one-time use only)
CREATE TABLE IF NOT EXISTS kasa_private.photo_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  UNIQUE (user_id, nonce)
);
CREATE INDEX IF NOT EXISTS photo_tokens_expires_at ON kasa_private.photo_tokens(expires_at);

-- Add EXIF GPS verification columns to photo_checks
ALTER TABLE kasa_private.photo_checks
ADD COLUMN IF NOT EXISTS exif_gps_lat FLOAT8,
ADD COLUMN IF NOT EXISTS exif_gps_lng FLOAT8,
ADD COLUMN IF NOT EXISTS exif_match BOOLEAN;

COMMIT;
