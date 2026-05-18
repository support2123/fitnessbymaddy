const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const db = getSupabase();
    await db.from('escalations').update({ resolved: true }).eq('id', id);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Resolve error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
