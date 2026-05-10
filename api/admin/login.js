const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    return res.status(200).json({
      access_token: data.session.access_token,
      user: { email: data.user.email }
    });
  } catch (err) {
    console.error('Admin login error:', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
};
