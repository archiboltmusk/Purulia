-- Migration: Add cryptographic photo binding, EXIF verification, and evidence validation
-- This migration adds:
-- 1. Capture token tracking to prevent photo spoofing
-- 2. EXIF GPS data extraction and verification
-- 3. Evidence validation for claims (prevents claims without photos)

BEGIN;

-- Table to track used capture tokens (one-time use only)
CREATE TABLE IF NOT EXISTS kasa_photo_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the JWT
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  INDEX (user_id, created_at),
  INDEX (expires_at) -- For cleanup queries
);

-- Add capture_token tracking to kasa_reports
ALTER TABLE kasa_reports
ADD COLUMN IF NOT EXISTS capture_token_hash TEXT UNIQUE;

-- Add EXIF GPS verification columns
ALTER TABLE kasa_photo_check_log
ADD COLUMN IF NOT EXISTS exif_gps_lat FLOAT8,
ADD COLUMN IF NOT EXISTS exif_gps_lng FLOAT8,
ADD COLUMN IF NOT EXISTS exif_match BOOLEAN; -- true if reported GPS ≤100m from EXIF GPS

-- Add evidence_path for claims (references the evidence photo)
ALTER TABLE kasa_claims
ADD COLUMN IF NOT EXISTS evidence_photo_hash TEXT REFERENCES kasa_photo_check_log(sha256) ON DELETE RESTRICT;

-- Function to clean up expired tokens (call periodically)
CREATE OR REPLACE FUNCTION kasa_cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM kasa_photo_tokens WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate and mark a token as used
CREATE OR REPLACE FUNCTION kasa_mark_token_used(p_user_id UUID, p_token_hash TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE kasa_photo_tokens
  SET used_at = now()
  WHERE user_id = p_user_id
    AND token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a claim has valid evidence
CREATE OR REPLACE FUNCTION kasa_validate_claim_evidence(p_report_id BIGINT, p_evidence_photo_hash TEXT)
RETURNS TABLE (valid BOOLEAN, reason TEXT) AS $$
BEGIN
  -- Check that photo exists and is not marked unsafe
  RETURN QUERY
  SELECT
    (ph.photo_hash IS NOT NULL AND NOT ph.unsafe) AS valid,
    CASE
      WHEN ph.photo_hash IS NULL THEN 'Evidence photo not found'::TEXT
      WHEN ph.unsafe THEN 'Evidence photo marked unsafe'::TEXT
      ELSE 'OK'::TEXT
    END AS reason
  FROM (
    SELECT sha256 as photo_hash, unsafe
    FROM kasa_photo_check_log
    WHERE sha256 = p_evidence_photo_hash
    LIMIT 1
  ) ph;

  -- If no photo found, return explicit failure
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Evidence photo not found'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
