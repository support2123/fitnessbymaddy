const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const db = getSupabase();

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter((l) => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach((c) => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingCheckinsList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.floor((now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)) + 1;
        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        if (!lastCheckin || lastCheckin.week_no < weekNo) {
          pendingCheckinsList.push({
            name: client.name || 'Unknown',
            program: client.program,
            week: weekNo,
            lastCheckin: lastCheckin ? lastCheckin.week_no : 0,
          });
        }
      }
    }

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        week: leadsWeek.count || 0,
        total: totalLeads,
        conversionRate,
      },
      clients: {
        active: activeClients.count || 0,
        byProgram: programCounts,
      },
      checkins: {
        pending: pendingCheckinsList,
      },
      programs: {
        generatedThisWeek: programsThisWeek.count || 0,
      },
      escalations: (recentEscalations.data || []).map((e) => ({
        phone: e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3),
        body: e.body,
        time: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
