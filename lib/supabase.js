import { createClient } from '@supabase/supabase-js';

// Server-side client. Uses the SERVICE ROLE key and bypasses RLS.
// NEVER import this module in anything shipped to the browser.
let _client = null;

export function db() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env missing');
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _client;
}

// Mask a phone number for logs. +917082478374 -> +91XXX...374
export function maskPhone(phone) {
  if (!phone) return '???';
  const p = String(phone);
  if (p.length < 6) return '***';
  return p.slice(0, 3) + 'XXX...' + p.slice(-3);
}
