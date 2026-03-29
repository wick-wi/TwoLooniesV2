-- Admin panel tables and schema changes
-- Phase 1: Foundation

-- 1A. Add is_admin flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 1B. Admin config key-value store (hot-swappable runtime settings)
CREATE TABLE IF NOT EXISTS public.admin_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; only service-role access from backend

-- Seed initial config values
INSERT INTO public.admin_config (key, value, description) VALUES
  ('gemini_model_pass1',            '"gemini-2.5-flash-lite"', 'Gemini model for pass 1 extraction (env: GEMINI_MODEL_PASS1)'),
  ('gemini_model_pass2',            '"gemini-2.5-flash"',      'Gemini model for pass 2 / fallback extraction (env: GEMINI_MODEL_PASS2)'),
  ('statement_parser',              '"pdfplumber"',             'Active parser: docling | gemini_native | pdfplumber | pdfplumber_v2 (env: STATEMENT_PARSER)'),
  ('enable_pass3',                  'true',                     'Enable Docling pass-3 fallback (env: ENABLE_PASS3)'),
  ('confidence_threshold',          '0.8',                      'Minimum LLM confidence score to accept a category (0-1)'),
  ('maintenance_mode',              'false',                    'When true, new file uploads are paused'),
  ('max_uploads_per_hour',          '50',                       'Max uploads per user per hour (rate limiting). Set to 0 to disable.'),
  ('max_statement_file_size_bytes', '5242880',                  'Max PDF/CSV file size in bytes (default 5 MB)'),
  -- Feature flags (prefix: flag_)
  ('flag_plaid_enabled',            'true',                     'Feature flag: enable/disable Plaid bank linking'),
  ('flag_csv_upload_enabled',       'true',                     'Feature flag: enable/disable CSV statement uploads'),
  ('flag_hard_delete_enabled',      'true',                     'Feature flag: enable the GDPR hard-delete button in admin')
ON CONFLICT (key) DO NOTHING;

-- 1C. Prompt versioning
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(prompt_key, version)
);
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; only service-role access from backend

-- 1D. Admin audit log
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; only service-role access from backend

-- Phase 2: Telemetry

-- 2A. Extraction events table for AI cost/latency/accuracy tracking
CREATE TABLE IF NOT EXISTS public.extraction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  statement_id uuid REFERENCES public.user_statements(id) ON DELETE SET NULL,
  job_id text,
  parser_name text NOT NULL,
  model_name text,
  pass_number integer DEFAULT 1,
  status text NOT NULL,
  error_message text,
  duration_ms integer,
  token_count_input integer,
  token_count_output integer,
  estimated_cost_usd numeric(10, 6),
  confidence_scores jsonb,
  transaction_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_extraction_events_created ON public.extraction_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_events_user ON public.extraction_events (user_id);
CREATE INDEX IF NOT EXISTS idx_extraction_events_status ON public.extraction_events (status);
ALTER TABLE public.extraction_events ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; only service-role access from backend

-- 2C. API request log for error rate and latency tracking
CREATE TABLE IF NOT EXISTS public.api_request_log (
  id bigserial PRIMARY KEY,
  path text NOT NULL,
  method text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_request_log_created ON public.api_request_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_status ON public.api_request_log (status_code);
ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies; only service-role access from backend
