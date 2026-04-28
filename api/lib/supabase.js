const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return client;
}

module.exports = { getSupabase };
