const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getSupabase();
    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.status(200).json({
      ok: true,
      token: data.session.access_token,
      email: data.user.email
    });
  } catch (err) {
    console.error('Admin login error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
