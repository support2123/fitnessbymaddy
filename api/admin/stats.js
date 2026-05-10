const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { count: pendingCheckins },
      { count: programsWeek },
      { data: recentEscalations }
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .not('id', 'in', supabase.from('checkins').select('client_id')),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekAgo),
      supabase.from('messages').select('*')
        .eq('direction', 'out')
        .like('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(10)
    ]);

    const programCounts = {};
    if (clientsByProgram) {
      for (const c of clientsByProgram) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: totalLeads || 0,
        converted: convertedLeads || 0,
        conversion_rate: conversionRate + '%'
      },
      clients: {
        active_by_program: programCounts,
        active_total: clientsByProgram?.length || 0
      },
      checkins: {
        pending: pendingCheckins || 0
      },
      programs: {
        generated_this_week: programsWeek || 0
      },
      escalations: (recentEscalations || []).map(e => ({
        phone: e.phone,
        body: e.body,
        sent_at: e.sent_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
