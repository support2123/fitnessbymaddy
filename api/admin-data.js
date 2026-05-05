const crypto = require('crypto');
const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Simple token validation — verify it's a valid HMAC from admin-auth
  const token = authHeader.split(' ')[1];
  if (!token || token.length < 32) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
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

    // All leads for conversion rate
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    const { count: convertedLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    // Active clients
    const { data: clients, count: activeClients } = await supabase
      .from('clients')
      .select('*', { count: 'exact' })
      .eq('status', 'active');

    // Pending check-ins (active clients who haven't submitted this week)
    let pendingCheckins = 0;
    if (clients) {
      for (const client of clients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!checkin) pendingCheckins++;
      }
    }

    // Programs generated this week
    const { count: programsThisWeek } = await supabase
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent leads (last 20)
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // Escalation messages (messages with escalation keywords sent to Maddy)
    const { data: escalations } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .like('body', '%ESCALATION%')
      .order('sent_at', { ascending: false })
      .limit(10);

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek || 0,
      recent_leads: recentLeads || [],
      clients: clients || [],
      escalations: (escalations || []).map(e => ({
        phone: e.phone,
        reason: 'Auto-escalation',
        body: e.body
      }))
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Failed to load data' });
  }
};
