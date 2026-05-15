const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsThisWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: activeClientsByProgram },
      { count: pendingCheckins },
      { count: programsThisWeek },
      { data: recentEscalations }
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('phone, body, sent_at')
        .eq('direction', 'out')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10)
    ]);

    const programCounts = {};
    for (const c of (activeClientsByProgram || [])) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : 0;

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsThisWeek || 0,
        total: totalLeads || 0,
        converted: convertedLeads || 0,
        conversion_rate: conversionRate + '%'
      },
      clients: {
        active_total: activeClientsByProgram?.length || 0,
        by_program: programCounts
      },
      operations: {
        pending_checkins: pendingCheckins || 0,
        programs_this_week: programsThisWeek || 0
      },
      escalations: (recentEscalations || []).map(e => ({
        body: e.body?.substring(0, 200),
        time: e.sent_at
      }))
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
