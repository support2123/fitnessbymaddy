const { createClient } = require('@supabase/supabase-js');

let _client = null;

/**
 * Creates (or returns cached) Supabase client using service role key.
 * Uses service role for server-side operations — never expose to the browser.
 */
function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}

module.exports = { getSupabase };
