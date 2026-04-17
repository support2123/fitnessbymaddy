const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

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
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('phone, body, sent_at')
        .eq('direction', 'out')
        .like('template_name', 'escalation%')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0
      ? ((convertedCount / totalLeadCount) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(function(e) {
        return {
          phone: e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3),
          body: e.body,
          sent_at: e.sent_at,
        };
      }),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return 0;

  let pending = 0;
  const now = new Date();

  for (const client of clients) {
    const start = new Date(client.program_started_at);
    const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const expectedWeek = Math.max(1, Math.ceil(daysSince / 7));

    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', expectedWeek)
      .limit(1);

    if (!data || data.length === 0) pending++;
  }

  return pending;
}
