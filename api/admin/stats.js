const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

    const [
      { count: leadsToday },
      { count: leadsThisWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { data: pendingCheckins },
      { data: programsThisWeek },
      { data: recentEscalations },
      { data: recentLeads },
      { data: recentClients },
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('*').gte('generated_at', weekStart),
      supabase.from('messages').select('*').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    const programCounts = {};
    for (const c of clientsByProgram || []) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const activeClients = pendingCheckins || [];
    const pendingList = [];
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      if (currentWeek < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        pendingList.push({ name: client.name, phone: client.phone, week: currentWeek, program: client.program });
      }
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_this_week: leadsThisWeek || 0,
      total_leads: totalLeads || 0,
      converted_leads: convertedLeads || 0,
      conversion_rate: conversionRate,
      active_clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: (programsThisWeek || []).length,
      escalations: (recentEscalations || []).map(e => ({
        phone: e.phone,
        body: e.body,
        sent_at: e.sent_at,
      })),
      recent_leads: (recentLeads || []).map(l => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      })),
      recent_clients: (recentClients || []).map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        program: c.program,
        status: c.status,
        paid_amount: c.paid_amount,
        program_started_at: c.program_started_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
