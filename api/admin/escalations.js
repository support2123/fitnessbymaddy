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

    const { data, error } = await db
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .like('body', '%[ESCALATION]%')
      .order('sent_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.status(200).json({ ok: true, messages: data || [] });
  } catch (err) {
    console.error('Admin escalations error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
