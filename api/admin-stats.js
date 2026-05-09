const { getSupabase } = require('./lib/supabase');
const { cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

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
      programsWeek,
      openEscalations,
      clientsByProgram
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('id', { count: 'exact', head: true }),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }),
      db.from('clients').select('program').eq('status', 'active')
    ]);

    const programCounts = {};
    (clientsByProgram.data || []).forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const activeClientsList = pendingCheckins.data || [];
    const pendingList = [];
    for (const client of activeClientsList) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      if (currentWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        pendingList.push({ name: client.name, phone: client.phone, week: currentWeek });
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalClients = allClients.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalClients / totalLeads) * 100).toFixed(1) : '0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      active_clients: activeClients.count || 0,
      conversion_rate: conversionRate,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsWeek.count || 0,
      open_escalations: openEscalations.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
