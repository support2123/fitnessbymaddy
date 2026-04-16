// Rename to `config.js` and fill in. Only the ANON key belongs here —
// never ship the service_role key to the browser.
// Row-level security policies in 0001_init.sql restrict reads to
// authenticated users (Maddy's Supabase email login).
export const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
