import { createClient } from '@supabase/supabase-js';

let cached = null;

export function supa() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cached;
}
