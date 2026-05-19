const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const pass = req.headers['x-admin-pass'];
  if (pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      { data: leadsAll },
      { count: leadsToday },
      { count: leadsWeek },
      { data: clients },
      { data: programsWeek },
      { data: recentLeads },
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact' }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      supabase.from('clients').select('id, program, status'),
      supabase.from('programs').select('id, client_id, flagged_for_review, generated_at').gte('generated_at', weekAgo.toISOString()),
      supabase.from('leads').select('id, name, phone, status, program_interest, market, created_at').order('created_at', { ascending: false }).limit(20),
    ]);

    const activeClients = (clients || []).filter(c => c.status === 'active');
    const totalLeads = leadsAll ? leadsAll.length : 0;
    const totalConverted = (clients || []).length;
    const conversionRate = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) : 0;

    const programCounts = {};
    (clients || []).forEach(c => {
      if (!programCounts[c.program]) programCounts[c.program] = { active: 0, completed: 0 };
      if (c.status === 'active') programCounts[c.program].active++;
      else if (c.status === 'completed') programCounts[c.program].completed++;
    });

    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 4) + '***' + l.phone.slice(-3) : '-',
    }));

    const escalations = (programsWeek || []).filter(p => p.flagged_for_review);

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients.length,
      programs_generated: (programsWeek || []).length,
      pending_checkins: activeClients.length,
      program_breakdown: programCounts,
      recent_leads: maskedLeads,
      escalations,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
