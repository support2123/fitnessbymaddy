const { supabase } = require('./_lib/supabase');
const { programWeeks } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: recentLeads },
      { data: activeClients },
      { count: programsWeek },
      { data: escalations },
    ] = await Promise.all([
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString()),
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'converted'),
      supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('clients')
        .select('*')
        .eq('status', 'active')
        .order('program_started_at', { ascending: false }),
      supabase
        .from('programs')
        .select('*', { count: 'exact', head: true })
        .gte('generated_at', weekStart.toISOString()),
      supabase
        .from('messages')
        .select('*')
        .eq('direction', 'out')
        .ilike('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(20),
    ]);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    const programCounts = {};
    if (activeClients) {
      for (const c of activeClients) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }
    const activeByProgram = Object.entries(programCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || '—';

    const pendingCheckins = [];
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        const total = programWeeks(client.program);

        if (currentWeek < 1 || currentWeek > total) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!existing) {
          pendingCheckins.push({
            name: client.name || 'Unknown',
            program: client.program,
            week_no: currentWeek,
            due: 'This week',
          });
        }
      }
    }

    return res.status(200).json({
      stats: {
        leads_today: leadsToday || 0,
        leads_week: leadsWeek || 0,
        conversion_rate: conversionRate,
        active_clients: activeClients?.length || 0,
        active_by_program: activeByProgram,
        programs_week: programsWeek || 0,
        pending_checkins: pendingCheckins.length,
      },
      leads: recentLeads || [],
      clients: activeClients || [],
      escalations: escalations || [],
      pending_checkins: pendingCheckins,
    });
  } catch (err) {
    console.error('[admin-data] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
