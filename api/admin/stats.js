const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: leadsToday },
    { count: leadsWeek },
    { count: totalLeads },
    { count: convertedLeads },
    { count: activeClients },
    { data: clients },
    { data: recentLeads },
    { data: recentCheckins },
    { count: programsWeek },
    { data: escalations },
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('clients').select('program, status').eq('status', 'active'),
    db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    db.from('checkins').select('*, clients(name)').order('form_submitted_at', { ascending: false }).limit(15),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('template_name', 'escalation').order('sent_at', { ascending: false }).limit(10),
  ]);

  const programBreakdown = {};
  if (clients) {
    clients.forEach(c => {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });
  }

  const pendingCheckins = await countPendingCheckins(db);

  const conversionRate = totalLeads > 0
    ? Math.round((convertedLeads / totalLeads) * 100)
    : 0;

  return res.status(200).json({
    leads_today: leadsToday || 0,
    leads_week: leadsWeek || 0,
    conversion_rate: conversionRate,
    active_clients: activeClients || 0,
    pending_checkins: pendingCheckins,
    programs_week: programsWeek || 0,
    program_breakdown: programBreakdown,
    recent_leads: recentLeads || [],
    recent_checkins: (recentCheckins || []).map(c => ({
      ...c,
      client_name: c.clients?.name || null,
    })),
    escalations: escalations || [],
  });
};

async function countPendingCheckins(db) {
  const { data: activeClients } = await db
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!activeClients) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);
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
