const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    clientsByProgram,
    recentLeads,
    programsWeek,
    escalations
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact' }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact' }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact' }),
    db.from('leads').select('id', { count: 'exact' }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact' }).eq('status', 'active'),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    db.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('direction', 'out').ilike('body', '%escalat%').order('sent_at', { ascending: false }).limit(10)
  ]);

  const programCounts = {};
  if (clientsByProgram.data) {
    clientsByProgram.data.forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });
  }

  const total = totalLeads.count || 0;
  const converted = convertedLeads.count || 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  // Calculate pending check-ins
  const activeClientCount = activeClients.count || 0;
  const { count: submittedThisWeek } = await db
    .from('checkins')
    .select('id', { count: 'exact' })
    .gte('form_submitted_at', weekStart);

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: conversionRate,
    active_clients: activeClientCount,
    pending_checkins: Math.max(0, activeClientCount - (submittedThisWeek || 0)),
    programs_week: programsWeek.count || 0,
    clients_by_program: Object.entries(programCounts).map(([program, count]) => ({ program, count })),
    recent_leads: (recentLeads.data || []).map(l => ({
      name: l.name,
      phone: l.phone,
      source: l.source,
      status: l.status,
      program_interest: l.program_interest,
      created_at: l.created_at
    })),
    escalations: (escalations.data || []).map(e => ({
      sent_at: e.sent_at,
      body: e.body
    }))
  });
};
