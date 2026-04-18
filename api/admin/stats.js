const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      droppedLeads,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, program_started_at, program_ends_at, status').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'dropped'),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek >= 1) {
          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .single();
          if (!checkin) pendingCount++;
        }
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const totalConverted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0';

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: totalLeads,
        dropped: droppedLeads.count || 0,
      },
      conversion: {
        converted: totalConverted,
        rate: conversionRate + '%',
      },
      clients: {
        active: activeClients.data?.length || 0,
        by_program: programCounts,
        list: (activeClients.data || []).map(c => ({
          id: c.id,
          name: c.name,
          program: c.program,
          started: c.program_started_at,
          ends: c.program_ends_at,
        })),
      },
      checkins: {
        pending: pendingCount,
      },
      programs: {
        generated_this_week: programsThisWeek.count || 0,
      },
      escalations: (recentEscalations.data || []).map(e => ({
        phone: e.phone?.slice(0, 3) + 'XXX...' + (e.phone?.slice(-3) || ''),
        body: e.body,
        at: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
