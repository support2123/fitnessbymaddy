const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart.toISOString()),
      supabase.from('escalations').select('id, phone, reason, message_body, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(20)
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programBreakdown = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      });
    }

    let pendingCheckinsList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSince / 7);
        if (currentWeek < 1) continue;

        const { data: lastCheckin } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastCheckin || lastCheckin.week_no < currentWeek) {
          pendingCheckinsList.push({
            client_id: client.id,
            name: client.name,
            program: client.program,
            expected_week: currentWeek,
            last_submitted_week: lastCheckin ? lastCheckin.week_no : 0
          });
        }
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckinsList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: openEscalations.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
