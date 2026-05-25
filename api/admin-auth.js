module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const allowedEmails = (process.env.ADMIN_EMAILS || 'support@fitnessbymaddy.com').split(',').map(e => e.trim().toLowerCase());

    if (!allowedEmails.includes(email.toLowerCase())) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    return res.status(200).json({
      supabase_url: process.env.SUPABASE_URL,
      supabase_key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY,
    });
  } catch (err) {
    console.error('Admin auth error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
