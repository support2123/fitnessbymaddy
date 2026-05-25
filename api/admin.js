const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
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
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact' }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact' }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact' }),
    db.from('leads').select('id', { count: 'exact' }).eq('status', 'converted'),
    db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('clients').select('id, name, program')
      .eq('status', 'active')
      .not('id', 'in',
        db.from('checkins')
          .select('client_id')
          .gte('form_submitted_at', weekStart)
      ),
    db.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekStart),
    db.from('messages').select('*')
      .eq('direction', 'out')
      .ilike('body', '%ESCALATION%')
      .order('sent_at', { ascending: false })
      .limit(10),
  ]);

  const programCounts = {};
  (clientsByProgram.data || []).forEach((c) => {
    programCounts[c.program] = (programCounts[c.program] || 0) + 1;
  });

  const totalLeadCount = totalLeads.count || 0;
  const convertedCount = convertedLeads.count || 0;
  const conversionRate = totalLeadCount > 0
    ? ((convertedCount / totalLeadCount) * 100).toFixed(1)
    : '0';

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsThisWeek.count || 0,
    total_leads: totalLeadCount,
    converted: convertedCount,
    conversion_rate: `${conversionRate}%`,
    active_clients: (activeClients.data || []).length,
    clients_by_program: programCounts,
    active_client_list: activeClients.data || [],
    programs_generated_this_week: programsThisWeek.count || 0,
    recent_escalations: recentEscalations.data || [],
  });
};
