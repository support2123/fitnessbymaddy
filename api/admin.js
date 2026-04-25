const db = require('./_lib/supabase');
const { cors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
      allClients,
      pendingCheckins,
      programsThisWeek,
      escalationMsgs,
    ] = await Promise.all([
      db.query('leads', `created_at=gte.${todayStart}&select=id`),
      db.query('leads', `created_at=gte.${weekStart}&select=id`),
      db.query('leads', 'select=id,status'),
      db.query('clients', 'status=eq.active&select=id,program,name,phone,program_started_at'),
      db.query('clients', 'select=id,status'),
      getPendingCheckins(),
      db.query('programs', `generated_at=gte.${weekStart}&select=id`),
      getEscalations(),
    ]);

    const convertedCount = allLeads.filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.length;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const byProgram = {};
    for (const c of activeClients) {
      byProgram[c.program] = (byProgram[c.program] || 0) + 1;
    }

    return res.status(200).json({
      leads_today: leadsToday.length,
      leads_this_week: leadsWeek.length,
      total_leads: totalLeads,
      conversion_rate: `${conversionRate}%`,
      active_clients: activeClients.length,
      total_clients: allClients.length,
      clients_by_program: byProgram,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.length,
      escalations: escalationMsgs,
    });
  } catch (err) {
    console.error('Admin API error:', err.message);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
};

async function getPendingCheckins() {
  const clients = await db.query('clients', 'status=eq.active&select=id,name,phone,program_started_at');
  const pending = [];

  for (const client of clients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;

    const existing = await db.query(
      'checkins',
      `client_id=eq.${client.id}&week_no=eq.${weekNo}&select=id`
    );
    if (existing.length === 0) {
      pending.push({ client_id: client.id, name: client.name, week_no: weekNo });
    }
  }

  return pending;
}

async function getEscalations() {
  const keywords = ['refund', 'injury', 'pain', 'complaint', 'medical', 'pregnant'];
  const recent = await db.query(
    'messages',
    `direction=eq.in&order=sent_at.desc&limit=50&select=phone,body,sent_at`
  );

  return recent.filter(m => {
    if (!m.body) return false;
    const lower = m.body.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  });
}

function calculateWeekNo(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000) / 7) + 1;
}
