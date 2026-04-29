const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Leads today
  const { count: leadsToday } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayStart);

  // Leads this week
  const { count: leadsWeek } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekStart);

  // Total leads
  const { count: leadsTotal } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });

  // Conversion rate
  const { count: convertedTotal } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'converted');

  const conversionRate = leadsTotal > 0
    ? ((convertedTotal / leadsTotal) * 100).toFixed(1)
    : '0.0';

  // Active clients by program
  const { data: clientsByProgram } = await supabase
    .from('clients')
    .select('program')
    .eq('status', 'active');

  const programCounts = {};
  (clientsByProgram || []).forEach(c => {
    programCounts[c.program] = (programCounts[c.program] || 0) + 1;
  });

  // Total active clients
  const { count: activeClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  // Pending check-ins (active clients who haven't submitted this week)
  const { data: allActive } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  let pendingCheckins = 0;
  for (const client of (allActive || [])) {
    const startDate = new Date(client.program_started_at);
    const weekNo = Math.ceil(
      (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const { data: ci } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();
    if (!ci) pendingCheckins++;
  }

  // Programs generated this week
  const { count: programsThisWeek } = await supabase
    .from('programs')
    .select('*', { count: 'exact', head: true })
    .gte('generated_at', weekStart);

  // Pending escalations
  const { data: escalations } = await supabase
    .from('escalations')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);

  // Recent leads
  const { data: recentLeads } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  return res.status(200).json({
    leads: {
      today: leadsToday || 0,
      this_week: leadsWeek || 0,
      total: leadsTotal || 0
    },
    conversion_rate: conversionRate,
    active_clients: activeClients || 0,
    clients_by_program: programCounts,
    pending_checkins: pendingCheckins,
    programs_generated_this_week: programsThisWeek || 0,
    escalations: escalations || [],
    recent_leads: recentLeads || []
  });
};
