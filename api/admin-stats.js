const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClientsRes,
      recentLeads,
      recentClients,
      programsWeek,
      escalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*').eq('status', 'active'),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const activeClients = activeClientsRes.data || [];
    const programCounts = {};
    activeClients.forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const pendingPromises = activeClients.map(async (client) => {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      if (currentWeek < 1) return false;
      const { data } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();
      return !data;
    });
    const pendingResults = await Promise.all(pendingPromises);
    const pendingCheckins = pendingResults.filter(Boolean).length;

    return res.json({
      leadsToday: leadsToday.count || 0,
      leadsWeek: leadsWeek.count || 0,
      conversionRate,
      activeClients: activeClients.length,
      pendingCheckins,
      programsWeek: programsWeek.count || 0,
      programCounts,
      recentLeads: recentLeads.data || [],
      recentClients: recentClients.data || [],
      escalations: escalations.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
