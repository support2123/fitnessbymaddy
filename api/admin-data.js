const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      recentLeads,
      programsWeek,
      escalations,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
    ]);

    const activeClientData = activeClients.data || [];
    const programCounts = {};
    for (const c of activeClientData) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
    const programsByType = Object.entries(programCounts).map(function([program, count]) {
      return { program, count };
    });

    const activeCount = activeClients.count || 0;

    const allCheckinClients = activeClientData.map(function(c) { return c.id; });
    let pendingCheckins = 0;
    if (allCheckinClients.length > 0) {
      const sundayCheck = new Date(now);
      sundayCheck.setDate(sundayCheck.getDate() - sundayCheck.getDay());
      sundayCheck.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .in('client_id', allCheckinClients)
        .gte('form_submitted_at', sundayCheck.toISOString());

      pendingCheckins = activeCount - (count || 0);
      if (pendingCheckins < 0) pendingCheckins = 0;
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_this_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      programs_by_type: programsByType,
      escalations: escalations.data || [],
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
