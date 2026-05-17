const { createClient } = require("@supabase/supabase-js");

let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
    }

    _supabase = createClient(url, key);
  }

  return _supabase;
}

module.exports = { getSupabase };
