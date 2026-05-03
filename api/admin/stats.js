const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: activeClients },
      { data: pendingCheckins },
      { data: programsThisWeek },
      { data: recentEscalations },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program_started_at').eq('status', 'active'),
      db.from('programs').select('id, client_id, week_no, generated_at').gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at').eq('template_name', 'admin_alert').order('sent_at', { ascending: false }).limit(10),
    ]);

    const programsByType = {};
    if (activeClients) {
      activeClients.forEach(c => {
        programsByType[c.program] = (programsByType[c.program] || 0) + 1;
      });
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) pendingCheckinCount++;
      }
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    return res.json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: totalLeads || 0,
        converted: convertedLeads || 0,
        conversion_rate: conversionRate + '%',
      },
      clients: {
        active: activeClients?.length || 0,
        by_program: programsByType,
      },
      checkins: {
        pending: pendingCheckinCount,
      },
      programs: {
        generated_this_week: programsThisWeek?.length || 0,
      },
      escalations: recentEscalations || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
