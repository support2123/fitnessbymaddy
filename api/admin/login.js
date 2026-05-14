const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getClient();

    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.status(200).json({
      token: data.session.access_token,
      user: { email: data.user.email },
    });
  } catch (err) {
    console.error('Admin login error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
