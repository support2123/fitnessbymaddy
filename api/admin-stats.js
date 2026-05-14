const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
      recentClients,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(supabase),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10),
      supabase.from('leads').select('*')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase.from('clients').select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const converted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : 0;

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: totalLeads,
      },
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(e => ({
        body: e.body,
        sent_at: e.sent_at,
      })),
      recent_leads: (recentLeads.data || []).map(l => ({
        id: l.id,
        name: l.name,
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      })),
      recent_clients: (recentClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        program: c.program,
        status: c.status,
        program_started_at: c.program_started_at,
      })),
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(supabase) {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!activeClients) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of activeClients) {
    const start = new Date(client.program_started_at);
    const weekNo = Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
    if (weekNo < 1) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!checkin) pending++;
  }

  return pending;
}
