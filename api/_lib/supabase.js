const { createClient } = require('@supabase/supabase-js');

let _admin = null;

function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

module.exports = { admin };
