const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [leadsToday, leadsWeek, totalLeads, converted, activeClients, escalations] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('program', { count: 'exact' }).eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).like('notes', '%FLAGGED%')
    ]);

    const total = totalLeads.count || 0;
    const conv = converted.count || 0;
    const rate = total > 0 ? Math.round((conv / total) * 100) : 0;

    const programCounts = {};
    if (activeClients.data) {
      activeClients.data.forEach(function(c) {
        var p = c.program || 'unknown';
        programCounts[p] = (programCounts[p] || 0) + 1;
      });
    }

    const byProgram = Object.entries(programCounts)
      .map(function(e) { return e[0] + ': ' + e[1]; })
      .join(', ') || 'None';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: rate,
      active_clients: activeClients.count || 0,
      by_program: byProgram,
      escalations: escalations.count || 0
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
