const { getSupabase } = require('../_lib/supabase');
const { handleCors } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

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
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(db),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      getEscalations(db)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
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
      converted_leads: convertedCount,
      conversion_rate: parseFloat(conversionRate),
      active_clients: (activeClients.data || []).length,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: recentEscalations
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, name, phone, program_started_at')
    .eq('status', 'active');

  if (!clients) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
    if (weekNo < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!checkin) pending++;
  }

  return pending;
}

async function getEscalations(db) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: messages } = await db
    .from('messages')
    .select('*')
    .eq('direction', 'out')
    .like('template_name', 'escalation%')
    .gte('sent_at', sevenDaysAgo)
    .order('sent_at', { ascending: false })
    .limit(10);

  return messages || [];
}
