const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.replace('Bearer ', '');
  const db = getClient();

  try {
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch {
    return res.status(401).json({ error: 'Auth failed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(db),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .like('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0
      ? ((convertedCount / totalLeadCount) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: conversionRate,
      active_clients: activeClients.data?.length || 0,
      active_clients_list: (activeClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        program: c.program,
        started: c.program_started_at,
      })),
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(m => ({
        phone: m.phone?.slice(0, 4) + 'XXX...' + (m.phone?.slice(-3) || ''),
        body: m.body?.slice(0, 150),
        sent_at: m.sent_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(db) {
  const { data: activeClients } = await db
    .from('clients')
    .select('id, name, program_started_at')
    .eq('status', 'active');

  if (!activeClients) return 0;

  let pending = 0;
  for (const client of activeClients) {
    const weekNo = Math.floor((Date.now() - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (!checkin) pending++;
  }
  return pending;
}
