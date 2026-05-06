const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [leadsToday, leadsWeek, allLeads, activeClients, allClients, pendingCheckins, programsWeek, escalations] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('id, phone, body, sent_at').eq('direction', 'out').ilike('body', '%ESCALATION%').gte('sent_at', weekStart),
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    const programBreakdown = {};
    if (activeClients.data) {
      for (const c of activeClients.data) {
        programBreakdown[c.program || 'unknown'] = (programBreakdown[c.program || 'unknown'] || 0) + 1;
      }
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!existing) pendingCheckinCount++;
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      total_clients: allClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckinCount,
      programs_generated_this_week: programsWeek.count || 0,
      escalations_this_week: escalations.data ? escalations.data.length : 0,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
