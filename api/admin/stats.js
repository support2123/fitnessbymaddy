const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsWeek,
      recentLeads,
      escalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*').eq('status', 'active'),
      supabase.from('clients').select('*'),
      getPendingCheckins(),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('*').eq('template_name', 'escalation_alert').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(10)
    ]);

    const totalCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalCount > 0 ? Math.round((convertedCount / totalCount) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: (activeClients.data || []).length,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      clients: allClients.data || [],
      escalations: escalations.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) return 0;

  let pending = 0;
  for (const client of activeClients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (!data) pending++;
  }
  return pending;
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  return Math.max(1, Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1);
}
