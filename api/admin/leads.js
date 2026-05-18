const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { data: leads } = await db
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.json({ leads: leads || [] });
  } catch (err) {
    console.error('Leads fetch error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
