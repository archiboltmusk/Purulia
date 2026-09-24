-- Purulia Civic Reporting System
-- Generic schema for civic issue reporting and tracking

BEGIN;

-- Table for civic reports
CREATE TABLE IF NOT EXISTS public.civic_reports (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  location_name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending_review',
  moderated_at TIMESTAMP,
  moderator_id UUID REFERENCES auth.users(id),
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

-- Table for moderation logs
CREATE TABLE IF NOT EXISTS public.moderation_logs (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT REFERENCES public.civic_reports(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES auth.users(id),
  action TEXT,
  reason TEXT,
  safety_check_result TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Table for report duplicates
CREATE TABLE IF NOT EXISTS public.report_duplicates (
  id BIGSERIAL PRIMARY KEY,
  report_id_a BIGINT REFERENCES public.civic_reports(id) ON DELETE CASCADE,
  report_id_b BIGINT REFERENCES public.civic_reports(id) ON DELETE CASCADE,
  distance_meters INTEGER,
  time_diff_hours INTEGER,
  flagged_at TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_civic_reports_status ON public.civic_reports(status);
CREATE INDEX IF NOT EXISTS idx_civic_reports_created_at ON public.civic_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_civic_reports_location ON public.civic_reports(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_report ON public.moderation_logs(report_id);
CREATE INDEX IF NOT EXISTS idx_report_duplicates_report_a ON public.report_duplicates(report_id_a);

COMMIT;
