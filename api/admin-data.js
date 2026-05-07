const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
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
      programsWeek,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status'),
      db.from('clients').select('id, program, name, phone, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('*', { count: 'exact', head: true }),
      db.from('checkins').select('id, client_id, week_no, created_at', { count: 'exact' }).is('form_submitted_at', null),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at').eq('direction', 'out').like('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10)
    ]);

    const totalLeads = allLeads.data ? allLeads.data.length : 0;
    const convertedLeads = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0';

    const programBreakdown = {};
    if (activeClients.data) {
      activeClients.data.forEach(c => {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      });
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.data ? activeClients.data.length : 0,
      total_clients: allClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckins.count || 0,
      programs_generated_week: programsWeek.count || 0,
      recent_escalations: recentEscalations.data || [],
      active_clients_list: (activeClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        program: c.program,
        started: c.program_started_at
      }))
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
