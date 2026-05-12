const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  try {
    const db = getSupabase();
    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentMessages
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(db, now),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('id, phone, reason, context, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      db.from('messages').select('id, phone, direction, body, sent_at').order('sent_at', { ascending: false }).limit(50)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0;

    return res.json({
      leadsToday: leadsToday.count || 0,
      leadsThisWeek: leadsWeek.count || 0,
      totalLeads,
      conversionRate: parseFloat(conversionRate),
      activeClients: activeClients.data || [],
      activeClientCount: activeClients.data?.length || 0,
      clientsByProgram: programCounts,
      pendingCheckins,
      programsGeneratedThisWeek: programsThisWeek.count || 0,
      escalations: openEscalations.data || [],
      recentMessages: recentMessages.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(db, now) {
  const { data: clients } = await db
    .from('clients')
    .select('id, name, phone, program_started_at')
    .eq('status', 'active');

  if (!clients) return [];

  const pending = [];
  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (!checkin || checkin.length === 0) {
      pending.push({ client_id: client.id, name: client.name, phone: client.phone, week_no: weekNo });
    }
  }
  return pending;
}
