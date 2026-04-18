const { getClient } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

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
    recentLeads,
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages')
      .select('*')
      .eq('template_name', 'escalation_alert')
      .order('sent_at', { ascending: false })
      .limit(10),
    db.from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // Count clients by program
  const programCounts = {};
  if (clientsByProgram.data) {
    for (const c of clientsByProgram.data) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
  }

  // Calculate pending check-ins (active clients who haven't submitted this week)
  let pendingCount = 0;
  if (pendingCheckins.data) {
    for (const client of pendingCheckins.data) {
      const weekNo = Math.floor(
        (now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)
      ) + 1;
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);
      if (!checkin || checkin.length === 0) pendingCount++;
    }
  }

  const totalLeadsCount = totalLeads.count || 0;
  const convertedCount = convertedLeads.count || 0;
  const conversionRate = totalLeadsCount > 0
    ? ((convertedCount / totalLeadsCount) * 100).toFixed(1)
    : '0';

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsThisWeek.count || 0,
    total_leads: totalLeadsCount,
    converted: convertedCount,
    conversion_rate: parseFloat(conversionRate),
    active_clients: activeClients.count || 0,
    clients_by_program: programCounts,
    pending_checkins: pendingCount,
    programs_generated_this_week: programsThisWeek.count || 0,
    recent_escalations: (recentEscalations.data || []).map((e) => ({
      phone: e.phone,
      body: e.body,
      time: e.sent_at,
    })),
    recent_leads: (recentLeads.data || []).map((l) => ({
      id: l.id,
      phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : '***',
      name: l.name,
      status: l.status,
      program_interest: l.program_interest,
      created_at: l.created_at,
    })),
  });
};
