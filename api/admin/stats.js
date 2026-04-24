const { supabase } = require('../../lib/supabase');

// Admin dashboard API — returns aggregated stats
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth via query param or header (Supabase Auth can be layered on)
  const key = req.headers.authorization?.replace('Bearer ', '') || req.query.key;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Leads today
    const { count: leadsToday } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Leads this week
    const { count: leadsWeek } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Total leads
    const { count: leadsTotal } = await supabase
      .from('leads').select('*', { count: 'exact', head: true });

    // Conversion count (lead -> paid)
    const { count: conversions } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: clientsByProgram } = await supabase
      .from('clients')
      .select('program')
      .eq('status', 'active');

    const programCounts = {};
    for (const c of clientsByProgram || []) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    // Total active clients
    const { count: activeClients } = await supabase
      .from('clients').select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Pending check-ins (clients who haven't submitted this week)
    const { data: allActive } = await supabase
      .from('clients').select('id, program_started_at').eq('status', 'active');

    let pendingCheckins = 0;
    for (const client of allActive || []) {
      const weekNo = Math.ceil((now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000));
      const { data: checkin } = await supabase
        .from('checkins').select('id').eq('client_id', client.id).eq('week_no', weekNo).single();
      if (!checkin) pendingCheckins++;
    }

    // Programs generated this week
    const { count: programsThisWeek } = await supabase
      .from('programs').select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Escalation messages (recent)
    const { data: escalations } = await supabase
      .from('messages')
      .select('*')
      .eq('template_name', 'escalation_alert')
      .order('sent_at', { ascending: false })
      .limit(10);

    // Leads by status
    const { data: leadsByStatus } = await supabase.rpc('count_leads_by_status').catch(() => ({ data: null }));

    // Manual fallback if RPC doesn't exist
    let statusCounts = {};
    if (!leadsByStatus) {
      for (const s of ['new', 'qualified', 'converted', 'dropped']) {
        const { count } = await supabase
          .from('leads').select('*', { count: 'exact', head: true }).eq('status', s);
        statusCounts[s] = count || 0;
      }
    } else {
      for (const row of leadsByStatus) {
        statusCounts[row.status] = row.count;
      }
    }

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: leadsTotal || 0,
        by_status: statusCounts
      },
      conversion_rate: leadsTotal ? ((conversions || 0) / leadsTotal * 100).toFixed(1) + '%' : '0%',
      clients: {
        active: activeClients || 0,
        by_program: programCounts
      },
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek || 0,
      escalations: (escalations || []).map(e => ({
        body: e.body,
        sent_at: e.sent_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
