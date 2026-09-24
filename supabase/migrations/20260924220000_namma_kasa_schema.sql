-- NammaKasa Database Schema
-- Complete schema for civic issue reporting and tracking system

BEGIN;

-- Create schema for NammaKasa
CREATE SCHEMA IF NOT EXISTS namma_kasa;

-- Table for wards (GBA 369 wards)
CREATE TABLE IF NOT EXISTS namma_kasa.wards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  ward_number INTEGER,
  corporation TEXT,
  mla_id INTEGER,
  mp_id INTEGER,
  boundaries GEOMETRY,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for MLAs
CREATE TABLE IF NOT EXISTS namma_kasa.mlas (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  constituency TEXT,
  party TEXT,
  elected_year INTEGER,
  contact_email TEXT,
  phone TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for MPs
CREATE TABLE IF NOT EXISTS namma_kasa.mps (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  lok_sabha_seat TEXT,
  party TEXT,
  elected_year INTEGER,
  contact_email TEXT,
  phone TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for citizen reports
CREATE TABLE IF NOT EXISTS namma_kasa.reports (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  description TEXT NOT NULL,
  ward_id INTEGER REFERENCES namma_kasa.wards(id),
  ward_name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'resolved', 'rejected')),
  moderated_at TIMESTAMP,
  moderator_id UUID,
  resolved_at TIMESTAMP,
  resolution_photo_path TEXT,
  exif_gps_lat FLOAT8,
  exif_gps_lng FLOAT8,
  exif_match BOOLEAN,
  garbage_score FLOAT8,
  unsafe BOOLEAN DEFAULT false,
  face_count INTEGER,
  sha256 TEXT,
  dhash TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Table for hot spots (clusters of reports)
CREATE TABLE IF NOT EXISTS namma_kasa.hotspots (
  id BIGSERIAL PRIMARY KEY,
  ward_id INTEGER REFERENCES namma_kasa.wards(id),
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_meters INTEGER DEFAULT 50,
  report_count INTEGER DEFAULT 0,
  latest_report_id BIGSERIAL REFERENCES namma_kasa.reports(id),
  detected_at TIMESTAMP DEFAULT now(),
  status TEXT DEFAULT 'active'
);

-- Table for cleanup streak tracking
CREATE TABLE IF NOT EXISTS namma_kasa.cleanup_streaks (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  resolutions_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for duplicate detection history
CREATE TABLE IF NOT EXISTS namma_kasa.duplicates (
  id BIGSERIAL PRIMARY KEY,
  report_id_a BIGSERIAL REFERENCES namma_kasa.reports(id),
  report_id_b BIGSERIAL REFERENCES namma_kasa.reports(id),
  distance_meters INTEGER,
  time_diff_hours INTEGER,
  flagged_at TIMESTAMP DEFAULT now()
);

-- Table for moderation logs
CREATE TABLE IF NOT EXISTS namma_kasa.moderation_logs (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGSERIAL REFERENCES namma_kasa.reports(id),
  moderator_id UUID REFERENCES auth.users(id),
  action TEXT CHECK (action IN ('approved', 'rejected', 'flagged')),
  reason TEXT,
  safety_check_result TEXT,
  duplicate_flag BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for ward-wise performance metrics
CREATE TABLE IF NOT EXISTS namma_kasa.ward_metrics (
  id BIGSERIAL PRIMARY KEY,
  ward_id INTEGER REFERENCES namma_kasa.wards(id) UNIQUE,
  total_reports INTEGER DEFAULT 0,
  resolved_reports INTEGER DEFAULT 0,
  avg_resolution_time_hours INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reports_ward_id ON namma_kasa.reports(ward_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON namma_kasa.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON namma_kasa.reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_location ON namma_kasa.reports USING GIST (ll_to_earth(latitude, longitude));
CREATE INDEX IF NOT EXISTS idx_hotspots_ward_id ON namma_kasa.hotspots(ward_id);
CREATE INDEX IF NOT EXISTS idx_duplicates_report_a ON namma_kasa.duplicates(report_id_a);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_report ON namma_kasa.moderation_logs(report_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_streaks_date ON namma_kasa.cleanup_streaks(date DESC);

-- RPC function to get reports in a geographic radius
CREATE OR REPLACE FUNCTION namma_kasa.reports_near(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 50
)
RETURNS TABLE (
  id BIGSERIAL,
  description TEXT,
  photo_path TEXT,
  distance_meters DOUBLE PRECISION,
  status TEXT
) AS $$
  SELECT
    r.id,
    r.description,
    r.photo_path,
    earth_distance(ll_to_earth(r.latitude, r.longitude), ll_to_earth(p_lat, p_lng))::INTEGER as distance_meters,
    r.status
  FROM namma_kasa.reports r
  WHERE r.status = 'approved'
    AND earth_distance(ll_to_earth(r.latitude, r.longitude), ll_to_earth(p_lat, p_lng)) <= p_radius_meters
  ORDER BY distance_meters ASC
  LIMIT 100;
$$ LANGUAGE SQL;

-- RPC function to detect hot spots (DBSCAN-like clustering)
CREATE OR REPLACE FUNCTION namma_kasa.detect_hotspots(
  p_days_back INTEGER DEFAULT 30,
  p_min_points INTEGER DEFAULT 5,
  p_radius_meters INTEGER DEFAULT 50
)
RETURNS TABLE (
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  report_count INTEGER
) AS $$
  WITH recent_reports AS (
    SELECT latitude, longitude, id
    FROM namma_kasa.reports
    WHERE status = 'approved'
      AND created_at >= now() - INTERVAL '1 day' * p_days_back
  ),
  clusters AS (
    SELECT
      avg(latitude) as center_lat,
      avg(longitude) as center_lng,
      count(*) as report_count
    FROM recent_reports r1
    WHERE (
      SELECT count(*)
      FROM recent_reports r2
      WHERE earth_distance(
        ll_to_earth(r1.latitude, r1.longitude),
        ll_to_earth(r2.latitude, r2.longitude)
      ) <= p_radius_meters
    ) >= p_min_points
    GROUP BY
      floor(latitude * 1000000),
      floor(longitude * 1000000)
  )
  SELECT * FROM clusters
  WHERE report_count >= p_min_points
  ORDER BY report_count DESC;
$$ LANGUAGE SQL;

-- RPC function to calculate resolution time for a report
CREATE OR REPLACE FUNCTION namma_kasa.report_resolution_time(p_report_id BIGSERIAL)
RETURNS TABLE (
  hours_taken INTEGER,
  resolution_date TIMESTAMP
) AS $$
  SELECT
    EXTRACT(EPOCH FROM (resolved_at - created_at))::INTEGER / 3600 as hours_taken,
    resolved_at
  FROM namma_kasa.reports
  WHERE id = p_report_id AND status = 'resolved';
$$ LANGUAGE SQL;

-- RPC function to update cleanup streak
CREATE OR REPLACE FUNCTION namma_kasa.update_cleanup_streak()
RETURNS TABLE (
  streak_days INTEGER,
  today_resolutions INTEGER
) AS $$
  WITH today_resolutions AS (
    SELECT count(*) as count
    FROM namma_kasa.reports
    WHERE status = 'resolved'
      AND DATE(resolved_at) = CURRENT_DATE
  ),
  streak AS (
    SELECT
      CASE
        WHEN (SELECT count FROM today_resolutions) > 0 THEN 1
        ELSE 0
      END as today_has_resolution
  ),
  active_streak AS (
    SELECT
      count(*) + CASE WHEN (SELECT today_has_resolution FROM streak) = 1 THEN 1 ELSE 0 END as streak_days
    FROM namma_kasa.cleanup_streaks
    WHERE active = true
      AND date >= CURRENT_DATE - INTERVAL '180 days'
    ORDER BY date DESC
    LIMIT 180
  )
  SELECT
    (SELECT COALESCE(streak_days, 0) FROM active_streak) as streak_days,
    (SELECT count FROM today_resolutions) as today_resolutions;
$$ LANGUAGE SQL;

-- Enable PostGIS extension for geographic queries
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS cube;

COMMIT;
