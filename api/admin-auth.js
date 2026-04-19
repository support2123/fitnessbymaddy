const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const validEmail = process.env.ADMIN_EMAIL || 'maddy@fitnessbymaddy.com';
    const validPass = process.env.ADMIN_PASSWORD;

    if (!validPass) {
      return res.status(500).json({ error: 'Admin not configured' });
    }

    if (email !== validEmail || password !== validPass) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.status(200).json({
      success: true,
      supabase_url: process.env.SUPABASE_URL,
      supabase_key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY
    });

  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
