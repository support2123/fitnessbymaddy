const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentLeads,
      recentClients
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact', head: false }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, phone, name, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('id, source_type, phone, reason, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      supabase.from('leads').select('id, phone, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(15),
      supabase.from('clients').select('id, name, phone, program, status, program_started_at, paid_amount').order('created_at', { ascending: false }).limit(15)
    ]);

    // Conversion rate
    const totalLeads = allLeads.data ? allLeads.data.length : 0;
    const convertedLeads = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Program breakdown
    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    // Count pending check-ins
    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weeksElapsed = Math.floor(
          (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        const currentWeek = weeksElapsed + 1;
        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);
        if (!checkin || checkin.length === 0) pendingCount++;
      }
    }

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_this_week: programsThisWeek.count || 0,
      escalations: openEscalations.data || [],
      recent_leads: (recentLeads.data || []).map(l => ({
        ...l,
        phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : ''
      })),
      recent_clients: (recentClients.data || []).map(c => ({
        ...c,
        phone: c.phone ? c.phone.slice(0, 3) + 'XXX...' + c.phone.slice(-3) : ''
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
