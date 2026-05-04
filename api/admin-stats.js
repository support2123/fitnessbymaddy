const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Leads today
    const { count: leadsToday } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Leads this week
    const { count: leadsWeek } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Total leads
    const { count: leadsTotal } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });

    // Converted leads
    const { count: leadsConverted } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: clientsByProgram } = await supabase
      .from('clients')
      .select('program, status')
      .eq('status', 'active');

    const programCounts = {};
    if (clientsByProgram) {
      for (const c of clientsByProgram) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    // Total active clients
    const { count: activeClients } = await supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    // Pending check-ins (active clients without a checkin this week)
    const { data: allActive } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    let pendingCheckins = [];
    if (allActive) {
      for (const client of allActive) {
        const weekNo = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          pendingCheckins.push({
            client_id: client.id,
            name: client.name,
            program: client.program,
            week_no: weekNo
          });
        }
      }
    }

    // Programs generated this week
    const { count: programsThisWeek } = await supabase
      .from('programs')
      .select('id', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Unresolved escalations
    const { data: escalations } = await supabase
      .from('escalations')
      .select('id, phone, trigger_keyword, message_body, created_at')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20);

    // Recent leads
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(15);

    const conversionRate = leadsTotal > 0
      ? ((leadsConverted / leadsTotal) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: leadsTotal || 0,
        converted: leadsConverted || 0,
        conversion_rate: conversionRate + '%'
      },
      clients: {
        active: activeClients || 0,
        by_program: programCounts
      },
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek || 0,
      escalations: escalations || [],
      recent_leads: recentLeads || []
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
