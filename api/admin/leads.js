const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const status = req.query.status;

    let query = db.from('leads').select('*').order('created_at', { ascending: false }).limit(100);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({ ok: true, leads: data || [] });
  } catch (err) {
    console.error('Admin leads error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
