const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      recentLeads,
      recentClients,
      programsWeek,
      allClients,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('leads').select('id, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(10),
      db.from('clients').select('id, name, program, status, program_started_at').eq('status', 'active').order('program_started_at', { ascending: false }).limit(10),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('clients').select('program, status, paid_amount'),
    ]);

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const activeCount = activeClients.count || 0;

    const pendingCheckins = await countPendingCheckins(db);

    const escalationCount = await countEscalations(db);

    const programsBreakdown = buildProgramBreakdown(allClients.data || []);

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_this_week: programsWeek.count || 0,
      escalations: escalationCount,
      recent_leads: recentLeads.data || [],
      recent_clients: recentClients.data || [],
      programs_breakdown: programsBreakdown,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function countPendingCheckins(db) {
  const { data: active } = await db
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!active || active.length === 0) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of active) {
    const start = new Date(client.program_started_at);
    const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.floor(daysSince / 7) + 1;

    const { data } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (!data) pending++;
  }

  return pending;
}

async function countEscalations(db) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('direction', 'out')
    .ilike('body', '%ESCALATION%')
    .gte('sent_at', weekAgo);

  return data ? data.length : 0;
}

function buildProgramBreakdown(clients) {
  const map = {};
  for (const c of clients) {
    const p = c.program || 'unknown';
    if (!map[p]) map[p] = { program: p, active: 0, completed: 0, revenue: 0 };
    if (c.status === 'active') map[p].active++;
    else if (c.status === 'completed') map[p].completed++;
    map[p].revenue += c.paid_amount || 0;
  }
  return Object.values(map);
}
