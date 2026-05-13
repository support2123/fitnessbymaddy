const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Verify Supabase auth token
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token required' });

  const db = getSupabase();

  // Verify token with Supabase Auth
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Leads today
  const { count: leadsToday } = await db
    .from('leads').select('*', { count: 'exact', head: true })
    .gte('created_at', todayStart);

  // Leads this week
  const { count: leadsWeek } = await db
    .from('leads').select('*', { count: 'exact', head: true })
    .gte('created_at', weekStart);

  // Total leads
  const { count: totalLeads } = await db
    .from('leads').select('*', { count: 'exact', head: true });

  // Converted leads
  const { count: convertedLeads } = await db
    .from('leads').select('*', { count: 'exact', head: true })
    .eq('status', 'converted');

  // Active clients by program
  const { data: activeClients } = await db
    .from('clients').select('program, status')
    .eq('status', 'active');

  const byProgram = {};
  for (const c of (activeClients || [])) {
    byProgram[c.program] = (byProgram[c.program] || 0) + 1;
  }

  // Pending check-ins (sent but not submitted)
  const { count: pendingCheckins } = await db
    .from('checkins').select('*', { count: 'exact', head: true })
    .is('form_submitted_at', null);

  // Programs generated this week
  const { count: programsWeek } = await db
    .from('programs').select('*', { count: 'exact', head: true })
    .gte('generated_at', weekStart);

  // Unresolved escalations
  const { data: escalations } = await db
    .from('escalations').select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(20);

  // Conversion rate
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

  return res.status(200).json({
    leads: { today: leadsToday || 0, week: leadsWeek || 0, total: totalLeads || 0 },
    conversion_rate: parseFloat(conversionRate),
    active_clients: {
      total: activeClients?.length || 0,
      by_program: byProgram
    },
    pending_checkins: pendingCheckins || 0,
    programs_generated_week: programsWeek || 0,
    escalations: escalations || []
  });
};
