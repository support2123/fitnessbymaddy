const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      leadsToday, leadsWeek, totalLeads, convertedLeads,
      activeClientsList, programsThisWeek, recentLeads,
      escalationMsgs,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),

      supabase.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString()),

      supabase.from('leads').select('id', { count: 'exact', head: true }),

      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('status', 'converted'),

      supabase.from('clients').select('id, program')
        .eq('status', 'active'),

      supabase.from('programs').select('id', { count: 'exact', head: true })
        .gte('generated_at', weekStart.toISOString()),

      supabase.from('leads').select('*')
        .order('created_at', { ascending: false })
        .limit(20),

      supabase.from('messages').select('*')
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(100),
    ]);

    const activeCount = activeClientsList.data?.length || 0;

    const clientsByProgram = {};
    (activeClientsList.data || []).forEach(c => {
      clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
    });

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const { data: allActiveClients } = await supabase
      .from('clients')
      .select('id, program_started_at')
      .eq('status', 'active');

    let pendingCheckins = 0;
    for (const client of allActiveClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!existing || existing.length === 0) pendingCheckins++;
    }

    const escalations = (escalationMsgs.data || []).filter(m => needsEscalation(m.body));

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_week: programsThisWeek.count || 0,
      clients_by_program: clientsByProgram,
      recent_leads: recentLeads.data || [],
      escalations: escalations.slice(0, 10),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
