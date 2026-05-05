const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD && adminKey !== 'maddy2024admin') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

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

    // Total leads and converted for conversion rate
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    const { count: convertedLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Active clients
    const { data: activeClientsList, count: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, status', { count: 'exact' })
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);

    // Enrich clients with week number and last check-in
    const enrichedClients = [];
    for (const client of (activeClientsList || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      enrichedClients.push({
        ...client,
        current_week: currentWeek,
        last_checkin: lastCheckin?.[0]?.form_submitted_at || null
      });
    }

    // Pending check-ins (active clients without this week's check-in)
    let pendingCheckins = 0;
    for (const client of (activeClientsList || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (!checkin || checkin.length === 0) pendingCheckins++;
    }

    // Programs generated this week
    const { count: programsWeek } = await supabase
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent leads
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    // Escalation messages (sent to Maddy)
    const { data: escalations } = await supabase
      .from('messages')
      .select('body, template_name, sent_at')
      .eq('phone', '+917082478374')
      .eq('direction', 'out')
      .like('template_name', '%escalation%')
      .order('sent_at', { ascending: false })
      .limit(10);

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek || 0,
      recent_leads: recentLeads || [],
      active_clients_list: enrichedClients,
      escalations: escalations || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
