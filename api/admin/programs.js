const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: programs } = await db
      .from('programs')
      .select('client_id, week_no, generated_at, whatsapp_sent_at, notes')
      .gte('generated_at', weekAgo)
      .order('generated_at', { ascending: false })
      .limit(30);

    if (!programs || programs.length === 0) {
      return res.status(200).json([]);
    }

    const clientIds = [...new Set(programs.map(p => p.client_id))];
    const { data: clients } = await db
      .from('clients')
      .select('id, name')
      .in('id', clientIds);

    const clientMap = {};
    (clients || []).forEach(c => { clientMap[c.id] = c.name; });

    const enriched = programs.map(p => ({
      client_name: clientMap[p.client_id] || 'Unknown',
      week_no: p.week_no,
      generated_at: p.generated_at,
      whatsapp_sent_at: p.whatsapp_sent_at,
      notes: p.notes
    }));

    return res.status(200).json(enriched);
  } catch (err) {
    console.error('Admin programs error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
