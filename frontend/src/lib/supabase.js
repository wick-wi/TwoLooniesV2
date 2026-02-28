import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
// Prefer publishable key (sb_publishable_...); fallback to legacy anon key
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY
  || process.env.REACT_APP_SUPABASE_ANON_KEY
  || '';

console.log("React thinks the Supabase URL is:", supabaseUrl);

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;
