import { createClient as _createClient } from '@supabase/supabase-js';

let client;

export function createClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }

  client = _createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return client;
}
