const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Missing password' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    return res.status(401).json({ success: false });
  }

  const token = crypto.randomBytes(32).toString('hex');

  return res.json({
    success: true,
    token,
    supabase_url: process.env.SUPABASE_URL,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY,
  });
};
