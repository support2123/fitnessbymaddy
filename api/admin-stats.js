const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Parallel queries
    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      openEscalations,
      recentLeads,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }),
      db.from('leads').select('id, phone, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('escalations').select('*').order('created_at', { ascending: false }).limit(10)
    ]);

    // Calculate program distribution
    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    // Calculate pending check-ins (active clients who haven't checked in this week)
    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weeksElapsed = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        const { data: latestCheckin } = await db.from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        if (!latestCheckin || latestCheckin.length === 0 || latestCheckin[0].week_no < weeksElapsed) {
          pendingCount++;
        }
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const totalConverted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      leads_total: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_this_week: programsWeek.count || 0,
      open_escalations: (openEscalations.data || []).length,
      recent_leads: recentLeads.data || [],
      escalations: recentEscalations.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
