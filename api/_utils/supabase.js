const { createClient } = require('@supabase/supabase-js');

let _client;

function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _client;
}

const TABLES = {
  LEADS: 'leads',
  CLIENTS: 'clients',
  CHECKINS: 'checkins',
  PROGRAMS: 'programs',
  MESSAGES: 'messages',
};

module.exports = { getSupabase, TABLES };
