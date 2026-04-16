// Returns PUBLIC Supabase values for the dashboard to initialise its browser
// client. Anon key is meant to be exposed; RLS + ADMIN_EMAILS gate everything.

import { json, methodNotAllowed } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  return json(res, 200, {
    supabase_url: process.env.SUPABASE_URL || '',
    supabase_anon: process.env.SUPABASE_ANON_KEY || ''
  });
}
