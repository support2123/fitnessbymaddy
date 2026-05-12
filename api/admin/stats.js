const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { data: clients },
      { data: leads },
      { count: programsWeek },
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
    ]);

    // Pending check-ins: active clients who haven't submitted this week's check-in
    let pendingCheckins = 0;
    if (clients) {
      for (const client of clients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);
        if (!existing || existing.length === 0) pendingCheckins++;
      }
    }

    // Escalation messages (last 7 days)
    const { data: escalations } = await supabase
      .from('messages')
      .select('*')
      .eq('phone', '+917082478374')
      .eq('direction', 'out')
      .gte('sent_at', weekStart)
      .order('sent_at', { ascending: false })
      .limit(10);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek || 0,
      clients: clients || [],
      leads: leads || [],
      escalations: escalations || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
