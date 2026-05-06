const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('messages')
      .select('id, phone, body, sent_at')
      .eq('direction', 'out')
      .like('template_name', 'escalation%')
      .gte('sent_at', weekAgo)
      .order('sent_at', { ascending: false })
      .limit(20);

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[Admin/Escalations]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
