const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
      activeClientsResult,
      pendingCheckinsResult,
      programsWeek,
      recentLeadsResult,
      escalationsResult
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('checkins').select('*', { count: 'exact', head: true }).is('form_submitted_at', null),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
    ]);

    const activeClients = activeClientsResult.data || [];
    const programBreakdown = {};
    for (const c of activeClients) {
      const prog = c.program || 'unknown';
      programBreakdown[prog] = (programBreakdown[prog] || 0) + 1;
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const clientsWithCheckins = await Promise.all(
      activeClients.map(async (c) => {
        const { data: lastCheckin } = await db
          .from('checkins')
          .select('form_submitted_at')
          .eq('client_id', c.id)
          .not('form_submitted_at', 'is', null)
          .order('week_no', { ascending: false })
          .limit(1)
          .maybeSingle();
        return { ...c, last_checkin: lastCheckin ? lastCheckin.form_submitted_at : null };
      })
    );

    return res.status(200).json({
      leadsToday: leadsToday.count || 0,
      leadsWeek: leadsWeek.count || 0,
      conversionRate,
      activeClientCount: activeClients.length,
      programBreakdown,
      pendingCheckins: pendingCheckinsResult.count || 0,
      programsThisWeek: programsWeek.count || 0,
      recentLeads: recentLeadsResult.data || [],
      activeClients: clientsWithCheckins,
      escalations: escalationsResult.data || []
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
