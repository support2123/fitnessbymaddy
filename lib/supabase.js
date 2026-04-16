import { createClient } from '@supabase/supabase-js';

let _client = null;

export function db() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing');
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _client;
}

export async function logMessage({ phone, direction, body, template_name, status, meta }) {
  try {
    await db().from('messages').insert({
      phone, direction, body: body || null,
      template_name: template_name || null,
      status: status || null,
      meta: meta || null
    });
  } catch (e) {
    // Never throw from audit logging.
    console.error('logMessage failed', e?.message);
  }
}
