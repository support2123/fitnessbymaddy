const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action || 'dashboard';
  const db = getSupabase();

  try {
    if (action === 'dashboard') {
      return res.status(200).json(await getDashboardData(db));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function getDashboardData(db) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsThisWeek,
    totalLeads,
    convertedLeads,
    activeClients,
    recentLeads,
    activeClientsList,
    programsThisWeek,
    escalations
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('*').eq('status', 'active'),
    db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    db.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }),
    db.from('programs').select('*, clients(name)').gte('generated_at', weekStart).order('generated_at', { ascending: false }),
    db.from('messages').select('*').eq('template_name', 'escalation_alert').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(10)
  ]);

  const totalLeadCount = totalLeads.count || 0;
  const convertedCount = convertedLeads.count || 0;
  const convRate = totalLeadCount > 0 ? Math.round((convertedCount / totalLeadCount) * 100) : 0;

  const pendingCheckinsList = [];
  if (activeClients.data) {
    for (const client of activeClients.data) {
      const startDate = new Date(client.program_started_at);
      const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSince / 7);
      if (currentWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1)
        .single();

      if (!checkin) {
        const dueDate = new Date(startDate.getTime() + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000);
        pendingCheckinsList.push({
          name: client.name,
          week: currentWeek,
          due_since: dueDate.toISOString()
        });
      }
    }
  }

  const programsList = (programsThisWeek.data || []).map(p => ({
    client_name: p.clients?.name || '—',
    week_no: p.week_no,
    generated_at: p.generated_at,
    whatsapp_sent_at: p.whatsapp_sent_at,
    pdf_url: p.pdf_url
  }));

  return {
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsThisWeek.count || 0,
    conversion_rate: convRate,
    total_converted: convertedCount,
    active_clients: (activeClients.data || []).length,
    pending_checkins: pendingCheckinsList.length,
    programs_this_week: (programsThisWeek.data || []).length,
    escalation_count: (escalations.data || []).length,
    recent_leads: recentLeads.data || [],
    active_clients_list: activeClientsList.data || [],
    pending_checkins_list: pendingCheckinsList,
    programs_list: programsList,
    escalations: escalations.data || []
  };
}
