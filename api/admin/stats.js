const { getClient } = require('../../lib/supabase');

function checkAuth(req) {
  const auth = req.headers.authorization;
  return auth === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { count: openEscalations },
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('escalations').select('id', { count: 'exact', head: true }).eq('resolved', false),
    ]);

    const { count: pendingCheckins } = await db
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins || 0,
      open_escalations: openEscalations || 0,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
