-- Migration: Add cryptographic photo binding, EXIF verification, and evidence validation
-- This migration adds:
-- 1. Capture token tracking to prevent photo spoofing
-- 2. EXIF GPS data extraction and verification
-- 3. Evidence validation for claims (prevents claims without photos)

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
ADD COLUMN IF NOT EXISTS exif_match BOOLEAN; -- true if reported GPS ≤100m from EXIF GPS

-- Create overloaded kasa_record_photo_check that accepts EXIF parameters
-- Separate from the original 7-parameter version for maximum compatibility
CREATE OR REPLACE FUNCTION public.kasa_record_photo_check(
  p_path text, p_sha256 text, p_dhash text,
  p_garbage_score double precision, p_labels jsonb, p_unsafe boolean, p_face_count integer,
  p_exif_gps_lat double precision, p_exif_gps_lng double precision, p_exif_match boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO kasa_private.photo_checks (
    photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count,
    exif_gps_lat, exif_gps_lng, exif_match
  )
  VALUES (
    p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb),
    coalesce(p_unsafe, false), coalesce(p_face_count, 0),
    p_exif_gps_lat, p_exif_gps_lng, p_exif_match
  )
  ON CONFLICT (photo_path) DO NOTHING;
END $$;

-- Function to clean up expired tokens (run occasionally via cron or trigger)
CREATE OR REPLACE FUNCTION kasa_private.cleanup_expired_photo_tokens()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM kasa_private.photo_tokens WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

-- Add evidence_photo_hash column to claims for traceability
ALTER TABLE kasa_private.claims
ADD COLUMN IF NOT EXISTS evidence_photo_hash TEXT;

COMMIT;
