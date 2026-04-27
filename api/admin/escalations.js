const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    if (req.method === 'POST' && req.url.includes('/resolve')) {
      const parts = req.url.split('/');
      const id = parts[parts.indexOf('escalations') + 1];

      await db.from('escalations').update({
        resolved: true,
        resolved_at: new Date().toISOString(),
      }).eq('id', id);

      return res.status(200).json({ ok: true });
    }

    const { data } = await db
      .from('escalations')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Admin escalations error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
