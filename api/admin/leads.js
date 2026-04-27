const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();
    const { data } = await db
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Admin leads error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
