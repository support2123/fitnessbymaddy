import { jsonResponse, corsHeaders } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const { password } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return jsonResponse(res, { ok: false, error: 'Invalid password' }, 401);
  }

  return jsonResponse(res, {
    ok: true,
    supabase_url: process.env.SUPABASE_URL,
    supabase_key: process.env.SUPABASE_SERVICE_KEY,
  });
}
