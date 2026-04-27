const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const db = getClient();
    await db.from('escalations').update({
      resolved: true,
      resolved_at: new Date().toISOString(),
    }).eq('id', id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Resolve escalation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
