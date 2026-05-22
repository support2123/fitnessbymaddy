const { getClient } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      recentLeads,
      recentCheckins,
      programsWeek
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('checkins').select('*, clients(name, phone)').order('form_submitted_at', { ascending: false }).limit(15),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart)
    ]);

    const clients = activeClients.data || [];
    const programCounts = {};
    const programRevenue = {};
    for (const c of clients) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      programRevenue[c.program] = (programRevenue[c.program] || 0) + (c.paid_amount || 0);
    }

    const programsByType = Object.keys(programCounts).map(p => ({
      program: p,
      count: programCounts[p],
      revenue: programRevenue[p]
    }));

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const checkinData = (recentCheckins.data || []).map(c => ({
      ...c,
      client_name: c.clients?.name || 'Unknown'
    }));

    const pendingCheckins = clients.filter(c => {
      const startDate = new Date(c.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
      return weekNo > 0;
    }).length;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: clients.length,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      escalations: 0,
      programs_by_type: programsByType,
      recent_leads: recentLeads.data || [],
      recent_checkins: checkinData
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
};
