// Single Supabase admin client shared by every serverless function.
// Uses the service_role key, so it bypasses RLS — never expose to the browser.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  // Fail loud at cold-start rather than silently returning mysterious errors.
  console.error('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'public' },
});

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'clients';
