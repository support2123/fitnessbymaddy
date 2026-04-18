const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      { data: clientsByProgram },
      { count: pendingCheckins },
      { count: programsThisWeek },
      { data: recentLeads },
      { data: escalations },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .not('id', 'in',
          db.from('checkins')
            .select('client_id')
            .gte('form_submitted_at', weekStart)
        ),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('leads').select('id, phone, name, status, program_interest, created_at')
        .order('created_at', { ascending: false }).limit(20),
      db.from('messages').select('phone, body, sent_at')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false }).limit(10),
    ]);

    const programCounts = {};
    (clientsByProgram || []).forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads: { today: leadsToday || 0, week: leadsWeek || 0, total: totalLeads || 0 },
      conversion_rate: conversionRate,
      active_clients: clientsByProgram?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins || 0,
      programs_this_week: programsThisWeek || 0,
      recent_leads: (recentLeads || []).map(l => ({
        ...l,
        phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : '***',
      })),
      escalations: (escalations || []).map(e => ({
        ...e,
        phone: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
