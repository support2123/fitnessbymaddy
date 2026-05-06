const { getSupabase } = require('../_lib/supabase');
const { corsHeaders } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentLeads,
      recentEscalations,
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      countPendingCheckins(supabase),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('*', { count: 'exact', head: true }).eq('resolved', false),
      supabase.from('leads').select('id, phone, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeadsCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadsCount > 0
      ? ((convertedCount / totalLeadsCount) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeadsCount,
      converted: convertedCount,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek.count || 0,
      open_escalations: openEscalations.count || 0,
      recent_leads: maskLeads(recentLeads.data || []),
      escalations: (recentEscalations.data || []).map(e => ({
        ...e,
        phone: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '',
      })),
    });
  } catch (err) {
    console.error('[ADMIN STATS ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

async function countPendingCheckins(supabase) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!clients?.length) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of clients) {
    const start = new Date(client.program_started_at);
    const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSince / 7);
    if (currentWeek < 1) continue;

    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1)
      .single();

    if (!data) pending++;
  }

  return pending;
}

function maskLeads(leads) {
  return leads.map(l => ({
    ...l,
    phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : '',
  }));
}
