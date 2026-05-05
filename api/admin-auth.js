const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = crypto.randomBytes(32).toString('hex');

  // Store token in memory (in production, use a proper session store)
  // For serverless, we'll use a simple HMAC-based token
  const hmac = crypto
    .createHmac('sha256', process.env.ADMIN_PASSWORD)
    .update(Date.now().toString())
    .digest('hex');

  return res.status(200).json({ token: hmac });
};
