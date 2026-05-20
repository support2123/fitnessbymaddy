const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { count: programsWeek },
      { data: recentLeads },
      { data: clientsByProgram },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekAgo.toISOString()),
      db.from('leads').select('id, name, phone, status, program_interest, created_at').order('created_at', { ascending: false }).limit(15),
      db.from('clients').select('program').eq('status', 'active'),
    ]);

    const programCounts = {};
    if (clientsByProgram) {
      for (const c of clientsByProgram) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const maskedLeads = (recentLeads || []).map((l) => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : null,
    }));

    return res.status(200).json({
      stats: {
        leads_today: leadsToday || 0,
        leads_week: leadsWeek || 0,
        conversion_rate: totalLeads > 0 ? Math.round(((convertedLeads || 0) / totalLeads) * 100) : 0,
        active_clients: activeClients || 0,
        programs_week: programsWeek || 0,
      },
      recent_leads: maskedLeads,
      clients_by_program: programCounts,
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
