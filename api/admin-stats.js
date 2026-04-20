const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
      recentClients,
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      db.from('leads').select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString()),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true })
        .eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
      db.from('clients').select('program')
        .eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at')
        .eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true })
        .gte('generated_at', weekStart.toISOString()),
      db.from('messages').select('*')
        .eq('direction', 'out')
        .ilike('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(10),
      db.from('leads').select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('clients').select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    let pendingCheckinsCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.floor(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;
        const { count } = await db.from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .eq('week_no', weekNo);
        if (!count) pendingCheckinsCount++;
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
      pending_checkins: pendingCheckinsCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(e => ({
        body: e.body,
        sent_at: e.sent_at,
      })),
      recent_leads: (recentLeads.data || []).map(l => ({
        id: l.id,
        name: l.name,
        phone: maskPhone(l.phone),
        status: l.status,
        program_interest: l.program_interest,
        created_at: l.created_at,
      })),
      recent_clients: (recentClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        phone: maskPhone(c.phone),
        program: c.program,
        status: c.status,
        program_started_at: c.program_started_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}
