-- Global toggle for Loonie AI (dashboard chat). Default on.
INSERT INTO public.admin_config (key, value, description) VALUES
  ('loonie_ai_enabled', 'true', 'When false, Loonie chat is hidden and /api/chat returns 503')
ON CONFLICT (key) DO NOTHING;
