const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      leadsToday,
      leadsThisWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      escalations,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase.from('clients').select('program')
        .eq('status', 'active'),
      supabase.from('clients').select('id, phone, name, program')
        .eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true })
        .gte('generated_at', weekStart.toISOString()),
      supabase.from('messages').select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .ilike('template_name', '%escalation%')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at || client.created_at);
        const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
        const expectedWeek = weeksSinceStart + 1;

        const { count } = await supabase
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .eq('week_no', expectedWeek);

        if (count === 0) pendingCount++;
      }
    }

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0
      ? ((convertedCount / totalLeadCount) * 100).toFixed(1)
      : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_this_week: programsThisWeek.count || 0,
      recent_escalations: escalations.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
