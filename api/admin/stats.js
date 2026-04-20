const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
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
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programCounts = {};
    (clientsByProgram.data || []).forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    // Calculate pending check-ins
    const pendingList = [];
    for (const client of (pendingCheckins.data || [])) {
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
        pendingList.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          week_no: currentWeek
        });
      }
    }

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: totalLeads,
        conversion_rate: parseFloat(conversionRate)
      },
      clients: {
        active: activeClients.count || 0,
        by_program: programCounts
      },
      checkins: {
        pending: pendingList
      },
      programs: {
        generated_this_week: programsThisWeek.count || 0
      },
      escalations: (recentEscalations.data || []).map(e => ({
        phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '***',
        body: e.body ? e.body.slice(0, 200) : '',
        time: e.sent_at
      }))
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
