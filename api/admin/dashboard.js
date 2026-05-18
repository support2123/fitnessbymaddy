const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      pendingCheckins,
      programsWeek,
      recentEscalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, program, status').eq('status', 'active'),
      supabase.from('clients').select('id, phone, name, program, program_started_at')
        .eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*')
        .eq('direction', 'out')
        .ilike('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(10)
    ]);

    const programCounts = {};
    if (activeClients.data) {
      for (const c of activeClients.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeads = allLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      converted_leads: converted,
      conversion_rate: `${conversionRate}%`,
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins.data?.length || 0,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: recentEscalations.data || []
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
