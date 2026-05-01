const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
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
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10)
    ]);

    const programCounts = {};
    (clientsByProgram.data || []).forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const pendingList = [];
    for (const client of (pendingCheckins.data || [])) {
      const weekNo = Math.ceil((now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weekNo < 1) continue;
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();
      if (!checkin) {
        pendingList.push({ name: client.name, phone: client.phone, week: weekNo, program: client.program });
      }
    }

    const conversionRate = totalLeads.count > 0
      ? ((convertedLeads.count / totalLeads.count) * 100).toFixed(1)
      : '0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads.count || 0,
      converted_leads: convertedLeads.count || 0,
      conversion_rate: conversionRate + '%',
      active_clients: (activeClients.data || []).length,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(function(m) {
        return { body: m.body, sent_at: m.sent_at };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
