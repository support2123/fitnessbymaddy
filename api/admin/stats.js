const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Leads today
    const { count: leadsToday } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Leads this week
    const { count: leadsWeek } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Total leads and converted
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });

    const { count: convertedLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'converted');

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    // Active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .order('program_started_at', { ascending: false });

    const activeClients = (clients || []).length;

    // Add current week to each client
    const clientsWithWeek = (clients || []).map(c => {
      const start = new Date(c.program_started_at);
      const week = Math.ceil((Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return { ...c, current_week: week };
    });

    // Pending check-ins (active clients who haven't submitted this week)
    let pendingCheckins = 0;
    for (const c of clientsWithWeek) {
      const { count } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', c.id)
        .eq('week_no', c.current_week);
      if (!count) pendingCheckins++;
    }

    // Programs generated this week
    const { count: programsThisWeek } = await supabase
      .from('programs')
      .select('id', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent leads
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek || 0,
      clients: clientsWithWeek,
      recent_leads: recentLeads || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
