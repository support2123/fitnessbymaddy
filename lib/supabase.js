const { createClient } = require('@supabase/supabase-js');

let _supabase;

function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

module.exports = { supabase };
