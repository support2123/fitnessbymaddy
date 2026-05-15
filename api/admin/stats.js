const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple API key auth for admin
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Leads today
    const { count: leadsToday } = await supabase()
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Leads this week
    const { count: leadsWeek } = await supabase()
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Total leads
    const { count: totalLeads } = await supabase()
      .from('leads')
      .select('*', { count: 'exact', head: true });

    // Converted leads (all time)
    const { count: convertedLeads } = await supabase()
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: activeClients } = await supabase()
      .from('clients')
      .select('program, status')
      .eq('status', 'active');

    const byProgram = {};
    if (activeClients) {
      for (const c of activeClients) {
        byProgram[c.program] = (byProgram[c.program] || 0) + 1;
      }
    }

    // Pending check-ins (active clients who haven't submitted this week)
    const { data: allActive } = await supabase()
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    let pendingCheckins = 0;
    const pendingList = [];

    if (allActive) {
      for (const client of allActive) {
        const weekNo = Math.ceil(
          (now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: checkin } = await supabase()
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          pendingCheckins++;
          pendingList.push({
            name: client.name,
            program: client.program,
            week: weekNo
          });
        }
      }
    }

    // Programs generated this week
    const { count: programsGenerated } = await supabase()
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Unresolved escalations
    const { data: escalations } = await supabase()
      .from('escalations')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    // Recent leads
    const { data: recentLeads } = await supabase()
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0';

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: totalLeads || 0,
        conversion_rate: `${conversionRate}%`,
        recent: recentLeads || []
      },
      clients: {
        active_total: activeClients?.length || 0,
        by_program: byProgram
      },
      checkins: {
        pending: pendingCheckins,
        pending_list: pendingList.slice(0, 10)
      },
      programs: {
        generated_this_week: programsGenerated || 0
      },
      escalations: escalations || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
