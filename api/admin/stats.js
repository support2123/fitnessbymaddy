const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization || '';
  const expectedKey = process.env.SUPABASE_SERVICE_KEY;
  if (!authHeader.includes(expectedKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsThisWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { data: activeClients },
      { data: pendingCheckins },
      { data: programsThisWeek },
      { data: recentEscalations }
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at, status').eq('status', 'active').order('program_started_at', { ascending: false }),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id, client_id, week_no, generated_at').gte('generated_at', weekStart).order('generated_at', { ascending: false }),
      db.from('messages').select('phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const programCounts = {};
    (clientsByProgram || []).forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    const clientIds = (activeClients || []).map(function(c) { return c.id; });
    let pendingCount = 0;

    if (clientIds.length > 0) {
      for (const client of (pendingCheckins || [])) {
        const startDate = new Date(client.program_started_at);
        const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSince / 7));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) pendingCount++;
      }
    }

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsThisWeek || 0,
        total: totalLeads || 0,
        conversion_rate: conversionRate
      },
      clients: {
        active: (activeClients || []).length,
        by_program: programCounts
      },
      checkins: {
        pending: pendingCount
      },
      programs: {
        generated_this_week: (programsThisWeek || []).length
      },
      escalations: (recentEscalations || []).map(function(e) {
        return {
          phone_masked: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '***',
          body: e.body,
          sent_at: e.sent_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
