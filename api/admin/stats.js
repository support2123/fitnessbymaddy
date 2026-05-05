const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { data: programData },
      { data: recentLeads },
      { count: programsWeek },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(10),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
    ]);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    const programCounts = {};
    if (programData) {
      for (const row of programData) {
        programCounts[row.program] = (programCounts[row.program] || 0) + 1;
      }
    }
    const programBreakdown = Object.entries(programCounts).map(([program, count]) => ({
      program, count
    }));

    const { data: activeClientsList } = await db
      .from('clients')
      .select('id, program_started_at, program')
      .eq('status', 'active');

    let pendingCheckins = 0;
    if (activeClientsList) {
      for (const client of activeClientsList) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek >= 1) {
          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .limit(1);
          if (!checkin || checkin.length === 0) pendingCheckins++;
        }
      }
    }

    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone_masked: maskPhone(l.phone),
      phone: undefined
    }));

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek || 0,
      program_breakdown: programBreakdown,
      recent_leads: maskedLeads,
      escalations: []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
