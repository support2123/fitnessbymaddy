const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false });

    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return res.status(500).json({ ok: false, error: 'Admin password not configured' });

    const isValid = crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(expected)
    );

    if (!isValid) return res.status(401).json({ ok: false });

    const token = crypto.randomBytes(32).toString('hex');
    // In production, store this token in a short-lived cache.
    // For simplicity, we sign it with HMAC so admin-data can verify.
    const sig = crypto
      .createHmac('sha256', process.env.INTERNAL_API_KEY || 'fbm-secret')
      .update(token)
      .digest('hex');

    return res.json({
      ok: true,
      token: token + '.' + sig,
      supabase_url: process.env.SUPABASE_URL,
      supabase_anon_key: process.env.SUPABASE_ANON_KEY,
    });
  } catch (err) {
    console.error('[ADMIN-AUTH ERROR]', err.message);
    return res.status(500).json({ ok: false });
  }
};
