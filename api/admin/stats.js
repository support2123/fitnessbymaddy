const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const db = getSupabase();

  try {
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Auth failed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { count: activeClients },
      { count: pendingCheckins },
      { count: programsThisWeek },
      { data: recentEscalations },
      { data: recentLeads }
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .not('id', 'in', db.from('checkins').select('client_id').gte('form_submitted_at', weekStart)),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
      db.from('leads').select('id, name, phone, status, program_interest, created_at')
        .order('created_at', { ascending: false }).limit(20)
    ]);

    const programCounts = {};
    if (clientsByProgram) {
      for (const c of clientsByProgram) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : 0;

    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 4) + '***' + l.phone.slice(-3) : '***'
    }));

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: totalLeads || 0,
        conversion_rate: conversionRate
      },
      clients: {
        active: activeClients || 0,
        by_program: programCounts
      },
      checkins: {
        pending: pendingCheckins || 0
      },
      programs: {
        generated_this_week: programsThisWeek || 0
      },
      escalations: recentEscalations || [],
      recent_leads: maskedLeads
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
