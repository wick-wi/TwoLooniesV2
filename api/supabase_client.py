"""Supabase client for backend. Uses secret key for admin operations."""
import os
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
# Prefer new secret key (sb_secret_...); fallback to legacy service_role for compatibility
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_KEY")

supabase = None
if SUPABASE_URL and SUPABASE_SECRET_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
