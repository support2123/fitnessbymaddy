const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

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
      allClients,
      recentPrograms,
      recentLeads,
      escalationMsgs,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*').eq('status', 'active'),
      supabase.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('*').eq('direction', 'in').order('sent_at', { ascending: false }).limit(10),
    ]);

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const activeClientsList = activeClients.data || [];
    const pendingCheckins = await countPendingCheckins(supabase, activeClientsList);

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClientsList.length,
      pending_checkins: pendingCheckins,
      programs_this_week: recentPrograms.count || 0,
      recent_leads: recentLeads.data || [],
      clients: allClients.data || [],
      escalations: (escalationMsgs.data || []).filter(isEscalationMsg),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function countPendingCheckins(supabase, clients) {
  let pending = 0;
  const now = new Date();

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (!data || data.length === 0) pending++;
  }

  return pending;
}

const ESCALATION_KEYWORDS = ['refund', 'lawyer', 'complaint', 'pain', 'injury', 'side effect'];

function isEscalationMsg(msg) {
  const lower = (msg.body || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}
