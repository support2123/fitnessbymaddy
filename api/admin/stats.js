const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsWeek,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id, program, status').eq('status', 'active'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    ]);

    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programBreakdown = {};
    for (const client of activeClients.data || []) {
      programBreakdown[client.program] = (programBreakdown[client.program] || 0) + 1;
    }

    const pendingList = [];
    for (const client of pendingCheckins.data || []) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        pendingList.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          week_no: weekNo,
        });
      }
    }

    const { data: recentEscalations } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .like('body', '%ESCALATION%')
      .order('sent_at', { ascending: false })
      .limit(10);

    return res.json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: totalLeads,
        conversion_rate: conversionRate,
      },
      clients: {
        active: (activeClients.data || []).length,
        total: allClients.count || 0,
        by_program: programBreakdown,
      },
      pending_checkins: pendingList,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: (recentEscalations || []).map(e => ({
        body: e.body,
        sent_at: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}
