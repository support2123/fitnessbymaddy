const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('checkins').select('id', { count: 'exact', head: true }).is('form_submitted_at', null),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*')
        .eq('direction', 'out')
        .like('body', '%ALERT%')
        .order('sent_at', { ascending: false })
        .limit(10)
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0.0';

    const programBreakdown = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      });
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate + '%',
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckins.count || 0,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(m => ({
        phone: m.phone.slice(0, 3) + 'XXX...' + m.phone.slice(-3),
        body: m.body ? m.body.slice(0, 100) : '',
        sent_at: m.sent_at
      }))
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
