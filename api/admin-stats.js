const { supabase } = require('../lib/supabase');

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
    return res.status(401).json({ error: 'Invalid session' });
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
      recentEscalations,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      getPendingCheckins(supabase),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*')
        .eq('direction', 'out')
        .like('template_name', 'escalation%')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programBreakdown = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek.count || 0,
      escalations: recentEscalations.data || [],
    });
  } catch (err) {
    console.error('[admin-stats]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(supabase) {
  const { data: active } = await supabase
    .from('clients')
    .select('id, name, phone, program_started_at')
    .eq('status', 'active');

  if (!active) return 0;

  let pending = 0;
  for (const client of active) {
    const weeksElapsed = Math.ceil(
      (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    if (weeksElapsed < 1) continue;

    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weeksElapsed)
      .limit(1);

    if (!checkin || checkin.length === 0) pending++;
  }

  return pending;
}
