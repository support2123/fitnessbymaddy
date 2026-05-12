const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const db = getSupabase();

  // Verify admin session via Supabase Auth
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries
  const [
    leadsToday,
    leadsThisWeek,
    allLeads,
    activeClients,
    pendingCheckins,
    programsThisWeek,
    recentEscalations
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id, status', { count: 'exact' }),
    db.from('clients').select('id, program, status').eq('status', 'active'),
    db.from('clients').select('id, phone, name, program, program_started_at').eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('direction', 'out').ilike('body', '%🚨%').order('sent_at', { ascending: false }).limit(10)
  ]);

  // Calculate conversion rate
  const totalLeads = allLeads.count || 0;
  const convertedLeads = (allLeads.data || []).filter(l => l.status === 'converted').length;
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

  // Count clients by program
  const programCounts = {};
  for (const c of (activeClients.data || [])) {
    programCounts[c.program] = (programCounts[c.program] || 0) + 1;
  }

  // Find pending check-ins (active clients who haven't submitted this week)
  const pendingList = [];
  for (const client of (pendingCheckins.data || [])) {
    const started = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - started) / (1000 * 60 * 60 * 24));
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!checkin) {
      pendingList.push({ name: client.name, phone: client.phone, program: client.program, week: weekNo });
    }
  }

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsThisWeek.count || 0,
    total_leads: totalLeads,
    conversion_rate: parseFloat(conversionRate),
    active_clients: (activeClients.data || []).length,
    clients_by_program: programCounts,
    pending_checkins: pendingList,
    programs_generated_this_week: programsThisWeek.count || 0,
    recent_escalations: (recentEscalations.data || []).map(m => ({
      phone: m.phone.slice(0, 4) + 'XXX...' + m.phone.slice(-3),
      body: m.body.substring(0, 200),
      sent_at: m.sent_at
    }))
  });
};
