const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getClient();
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
      pendingCheckins,
      escalations,
      clientsByProgram
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('clients')
        .select('id')
        .eq('status', 'active'),
      db.from('messages')
        .select('*')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10),
      db.from('clients').select('program').eq('status', 'active')
    ]);

    const programBreakdown = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        const p = c.program || 'unknown';
        programBreakdown[p] = (programBreakdown[p] || 0) + 1;
      }
    }

    const active12wk = programBreakdown['12wk'] || 0;
    const active6wk = (programBreakdown['6wk_gym'] || 0) + (programBreakdown['6wk_home'] || 0);

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const { count } = await db
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('form_submitted_at', weekStart);
        if ((count || 0) === 0) pendingCount++;
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      active_12wk: active12wk,
      active_6wk: active6wk,
      programs_week: programsWeek.count || 0,
      pending_checkins: pendingCount,
      recent_leads: recentLeads.data || [],
      programs_breakdown: programBreakdown,
      escalations: escalations.data || []
    });

  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
