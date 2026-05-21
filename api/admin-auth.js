const { getClient } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, {});
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return jsonResponse(res, 400, { error: 'Email and password required' });
    }

    const db = getClient();
    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return jsonResponse(res, 401, { error: 'Invalid credentials' });
    }

    return jsonResponse(res, 200, { token: data.session.access_token });
  } catch (err) {
    console.error('Admin auth error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
