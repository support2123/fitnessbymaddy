const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: activeClients },
      { count: totalLeads },
      { count: convertedLeads },
      { count: pendingCheckins },
      { count: programsWeek },
      { data: recentLeads },
      { data: activeClientsList },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart.toISOString()),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }).limit(20),
    ]);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      active_clients: activeClients || 0,
      conversion_rate: conversionRate,
      pending_checkins: pendingCheckins || 0,
      programs_week: programsWeek || 0,
      recent_leads: recentLeads || [],
      active_clients_list: activeClientsList || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
