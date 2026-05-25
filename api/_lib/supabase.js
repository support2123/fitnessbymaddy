const { createClient } = require("@supabase/supabase-js");

let _client = null;

/**
 * Returns a Supabase client configured with the service-role key.
 * Re-uses the same instance across invocations within a single
 * serverless cold-start to avoid unnecessary object creation.
 */
function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing required env vars: SUPABASE_URL and/or SUPABASE_SERVICE_KEY"
    );
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _client;
}

module.exports = { getSupabase };
