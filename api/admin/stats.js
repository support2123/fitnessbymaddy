const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { count: pendingCheckins },
      { count: programsWeek },
      { count: openEscalations }
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .not('id', 'in', db.from('checkins').select('client_id')),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*', { count: 'exact', head: true }).eq('resolved', false)
    ]);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    return res.json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins || 0,
      programs_week: programsWeek || 0,
      open_escalations: openEscalations || 0
    });

  } catch (err) {
    console.error('Stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
