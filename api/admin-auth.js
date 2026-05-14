const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return res.status(500).json({ error: 'Admin password not configured' });
    }

    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(adminPassword).digest('hex');

    if (inputHash !== expectedHash) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    return res.status(200).json({
      success: true,
      token,
      supabase_url: process.env.SUPABASE_URL,
      supabase_key: process.env.SUPABASE_ANON_KEY,
    });
  } catch (err) {
    console.error('Admin auth error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
