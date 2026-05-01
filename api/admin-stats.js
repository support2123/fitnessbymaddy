const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const token = authHeader.replace('Bearer ', '');

  try {
    const { data: user, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });
  } catch {
    return res.status(401).json({ error: 'Auth failed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday, leadsWeek, allLeads,
      activeClients, allClients,
      pendingCheckins, programsWeek, escalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id, program, name, phone, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('id', { count: 'exact', head: true }),
      db.from('clients').select('id, name, phone, program').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at')
        .eq('template_name', 'escalation_alert')
        .gte('sent_at', weekStart)
        .order('sent_at', { ascending: false })
        .limit(20)
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    // Program breakdown
    const programBreakdown = {};
    if (activeClients.data) {
      activeClients.data.forEach(function(c) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      });
    }

    // Pending checkins: active clients who haven't submitted this week's checkin
    let pendingCheckinsList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at || now);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          pendingCheckinsList.push({
            client_id: client.id,
            name: client.name,
            program: client.program,
            week_no: currentWeek
          });
        }
      }
    }

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.data ? activeClients.data.length : 0,
      total_clients: allClients.count || 0,
      programs_by_type: programBreakdown,
      pending_checkins: pendingCheckinsList,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: escalations.data || [],
      active_clients_list: (activeClients.data || []).map(function(c) {
        return {
          id: c.id,
          name: c.name,
          program: c.program,
          started: c.program_started_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
