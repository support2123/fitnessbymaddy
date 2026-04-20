const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      escalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      countPendingCheckins(),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('direction', 'out')
        .like('template_name', 'escalation%')
        .gte('sent_at', weekStart)
    ]);

    const byProgram = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        byProgram[c.program || 'unknown'] = (byProgram[c.program || 'unknown'] || 0) + 1;
      }
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: rate,
      active_clients: activeClients.count || 0,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      escalations: escalations.count || 0,
      by_program: byProgram
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function countPendingCheckins() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!clients) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of clients) {
    if (!client.program_started_at) continue;
    const start = new Date(client.program_started_at);
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const expectedWeek = Math.ceil(diffDays / 7);
    if (expectedWeek < 1) continue;

    const { count } = await supabase
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('week_no', expectedWeek);

    if (!count || count === 0) pending++;
  }

  return pending;
}
