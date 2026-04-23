import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Supabase auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    // Run all queries in parallel
    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      totalConverted,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentLeads,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', weekStart.toISOString()),
      supabase.from('leads').select('id', { count: 'exact' }),
      supabase.from('leads').select('id', { count: 'exact' }).eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekStart.toISOString()),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    // Calculate pending check-ins
    const pendingList = [];
    for (const client of (pendingCheckins.data || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSince / 7) + 1;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        pendingList.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          week_no: currentWeek,
        });
      }
    }

    // Group clients by program
    const programCounts = {};
    for (const c of (clientsByProgram.data || [])) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const conversionRate = totalLeads.count > 0
      ? ((totalConverted.count / totalLeads.count) * 100).toFixed(1)
      : 0;

    return res.status(200).json({
      ok: true,
      data: {
        leads_today: leadsToday.count || 0,
        leads_this_week: leadsWeek.count || 0,
        total_leads: totalLeads.count || 0,
        conversion_rate: parseFloat(conversionRate),
        active_clients: activeClients.count || 0,
        clients_by_program: programCounts,
        pending_checkins: pendingList,
        programs_generated_this_week: programsThisWeek.count || 0,
        escalations: (openEscalations.data || []).map(e => ({
          id: e.id,
          trigger: e.trigger,
          message: e.message,
          created_at: e.created_at,
          phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : null,
        })),
        recent_leads: (recentLeads.data || []).map(l => ({
          id: l.id,
          name: l.name,
          status: l.status,
          program_interest: l.program_interest,
          market: l.market,
          created_at: l.created_at,
          phone: l.phone ? l.phone.slice(0, 4) + 'XXX...' + l.phone.slice(-3) : null,
        })),
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
