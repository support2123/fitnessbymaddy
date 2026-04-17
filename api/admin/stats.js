const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { data: activeClients },
      { data: pendingCheckins },
      { data: programsThisWeek },
      { data: recentEscalations }
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active').order('program_started_at', { ascending: false }),
      supabase.from('clients').select('id, name, phone, program').eq('status', 'active'),
      supabase.from('programs').select('id').gte('generated_at', weekStart.toISOString()),
      supabase.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const programCounts = {};
    if (clientsByProgram) {
      clientsByProgram.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

    return res.status(200).json({
      leads: { today: leadsToday || 0, week: leadsWeek || 0, total: totalLeads || 0 },
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients || [],
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins ? pendingCheckins.length : 0,
      programs_this_week: programsThisWeek ? programsThisWeek.length : 0,
      escalations: recentEscalations || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
