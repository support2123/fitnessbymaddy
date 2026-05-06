const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [leadsToday, leadsWeek, totalLeads, converted, activeClients, programsWeek] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekAgo.toISOString())
    ]);

    const total = totalLeads.count || 0;
    const conv = converted.count || 0;
    const rate = total > 0 ? Math.round((conv / total) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: rate,
      active_clients: activeClients.count || 0,
      programs_week: programsWeek.count || 0
    });
  } catch (err) {
    console.error('[Admin/Stats]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
