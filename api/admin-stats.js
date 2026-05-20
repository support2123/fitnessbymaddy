const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

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
      escalations,
      programsWeek
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*').eq('status', 'active'),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart)
    ]);

    const activeClientsList = activeClients.data || [];
    const programCounts = {};
    activeClientsList.forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });
    const clientsByProgram = Object.entries(programCounts).map(([program, count]) => ({ program, count }));

    const clientIds = activeClientsList.map(c => c.id);
    let pendingCheckins = 0;
    for (const client of activeClientsList) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      if (weekNo < 1) continue;

      const { data } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!data || data.length === 0) pendingCheckins++;
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClientsList.length,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      clients_by_program: clientsByProgram,
      escalations: (escalations.data || []).map(e => ({
        created_at: e.created_at,
        phone: e.phone,
        reason: e.reason,
        message: e.message
      })),
      recent_leads: (recentLeads.data || []).map(l => ({
        created_at: l.created_at,
        name: l.name,
        market: l.market,
        program_interest: l.program_interest,
        status: l.status
      }))
    });
  } catch (err) {
    console.error('[AdminStats] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
