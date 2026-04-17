const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPass) {
    return res.status(500).json({ error: 'Admin credentials not configured' });
  }

  if (email !== adminEmail || password !== adminPass) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const payload = `${token}:${expiry}`;
  const hmac = crypto.createHmac('sha256', adminPass).update(payload).digest('hex');
  const sessionToken = Buffer.from(`${payload}:${hmac}`).toString('base64');

  return res.status(200).json({ token: sessionToken });
};
