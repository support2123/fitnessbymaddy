const { getSupabase } = require('./lib/supabase');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
  const { count: leadsThisWeek } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekStart);

  // Total leads and converted
  const { count: totalLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });

  const { count: convertedLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'converted');

  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

  // Active clients by program
  const { data: activeClients } = await supabase
    .from('clients')
    .select('program')
    .eq('status', 'active');

  const clientsByProgram = {};
  (activeClients || []).forEach(c => {
    clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
  });

  // Pending check-ins (active clients without this week's check-in)
  const { data: allActive } = await supabase
    .from('clients')
    .select('id, name, phone, program_started_at')
    .eq('status', 'active');

  let pendingCheckins = 0;
  for (const client of (allActive || [])) {
    const startDate = new Date(client.program_started_at);
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);
    if (!checkin || checkin.length === 0) pendingCheckins++;
  }

  // Programs generated this week
  const { count: programsThisWeek } = await supabase
    .from('programs')
    .select('*', { count: 'exact', head: true })
    .gte('generated_at', weekStart);

  // Escalations (last 7 days)
  const { data: escalations } = await supabase
    .from('messages')
    .select('*')
    .eq('template_name', 'escalation_alert')
    .gte('sent_at', weekStart)
    .order('sent_at', { ascending: false })
    .limit(10);

  // Recent leads
  const { data: recentLeads } = await supabase
    .from('leads')
    .select('id, name, phone, status, program_interest, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const maskedLeads = (recentLeads || []).map(l => ({
    ...l,
    phone: maskPhone(l.phone),
  }));

  return res.status(200).json({
    leads_today: leadsToday || 0,
    leads_this_week: leadsThisWeek || 0,
    conversion_rate: parseFloat(conversionRate),
    active_clients: clientsByProgram,
    active_clients_total: activeClients?.length || 0,
    pending_checkins: pendingCheckins,
    programs_generated_this_week: programsThisWeek || 0,
    escalations: escalations || [],
    recent_leads: maskedLeads,
  });
};
