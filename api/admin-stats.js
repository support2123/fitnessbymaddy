const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', today.toISOString()),
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', weekAgo.toISOString()),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekAgo.toISOString()),
      supabase.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const convertedLeads = allLeads.data?.filter(l => l.status === 'converted').length || 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

    const programBreakdown = {};
    (clientsByProgram.data || []).forEach(c => {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });

    let pendingCount = 0;
    for (const client of (pendingCheckins.data || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);
      if (!checkin || checkin.length === 0) pendingCount++;
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).length
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
