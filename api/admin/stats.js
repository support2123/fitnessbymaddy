const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      recentLeads,
      activeClientsList,
      recentCheckins,
      programsWeek,
      escalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }),
      db.from('checkins').select('*, clients(name)').order('form_submitted_at', { ascending: false }).limit(15),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
    ]);

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const activeCount = activeClients.count || 0;
    const pendingCheckins = await countPendingCheckins(db, activeClientsList.data || []);

    const checkinData = (recentCheckins.data || []).map(ci => ({
      ...ci,
      client_name: ci.clients?.name || null,
    }));

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      active_clients_list: activeClientsList.data || [],
      recent_checkins: checkinData,
      escalations: escalations.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function countPendingCheckins(db, activeClients) {
  let pending = 0;
  for (const client of activeClients) {
    if (!client.program_started_at) continue;
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

    const { data } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (!data?.length) pending++;
  }
  return pending;
}
