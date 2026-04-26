const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      escalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      getRecentEscalations()
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0;

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: escalations,
      active_clients_list: (activeClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        program: c.program,
        started: c.program_started_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return 0;

  let pending = 0;
  for (const client of clients) {
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

async function getRecentEscalations() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('phone, body, sent_at')
    .eq('direction', 'out')
    .like('body', '%ESCALATION%')
    .gte('sent_at', weekAgo)
    .order('sent_at', { ascending: false })
    .limit(10);

  return data || [];
}

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}
