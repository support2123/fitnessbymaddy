const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('id, phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
      supabase.from('leads').select('id, phone, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach((c) => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0 ? ((convertedCount / totalLeadCount) * 100).toFixed(1) : 0;

    const pendingList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const daysSinceStart = Math.floor((now - new Date(client.program_started_at)) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!existing || existing.length === 0) {
          pendingList.push({ ...client, week_no: currentWeek });
        }
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: conversionRate,
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: recentEscalations.data || [],
      recent_leads: recentLeads.data || [],
      active_client_list: activeClients.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
