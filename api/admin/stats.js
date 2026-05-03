const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      programsWeek,
      openEscalations,
      recentLeads,
      escalations,
      clientsByProgram,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      db.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString()),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true })
        .eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true })
        .gte('generated_at', weekStart.toISOString()),
      db.from('escalations').select('id', { count: 'exact', head: true })
        .eq('resolved', false),
      db.from('leads').select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('escalations').select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(10),
      db.from('clients').select('program')
        .eq('status', 'active'),
    ]);

    const programBreakdown = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      }
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const activeCount = activeClients.count || 0;
    let pendingCheckins = 0;

    if (activeCount > 0) {
      const { data: activeClientsList } = await db
        .from('clients')
        .select('id, program_started_at')
        .eq('status', 'active');

      if (activeClientsList) {
        for (const client of activeClientsList) {
          const weekNo = Math.floor(
            (Date.now() - new Date(client.program_started_at).getTime()) /
            (7 * 24 * 60 * 60 * 1000)
          ) + 1;

          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .limit(1)
            .single();

          if (!checkin) pendingCheckins++;
        }
      }
    }

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      open_escalations: openEscalations.count || 0,
      program_breakdown: programBreakdown,
      recent_leads: recentLeads.data || [],
      escalations: escalations.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
