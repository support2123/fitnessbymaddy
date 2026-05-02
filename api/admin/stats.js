const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Simple auth check via Supabase session or API key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid session' });
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

    // Total leads
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    // Converted leads (for conversion rate)
    const { count: convertedLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: clientsByProgram } = await supabase
      .from('clients')
      .select('program, status')
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
    const currentWeekClients = (clientsByProgram || []).length;
    const { count: checkinsDone } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .gte('form_submitted_at', weekStart);

    const pendingCheckins = Math.max(0, currentWeekClients - (checkinsDone || 0));

    // Programs generated this week
    const { count: programsGenerated } = await supabase
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent escalations (messages with escalation template to Maddy)
    const { data: escalations } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .eq('template_name', 'escalation_alert')
      .order('sent_at', { ascending: false })
      .limit(10);

    // Recent leads
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // Recent clients
    const { data: recentClients } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json({
      leads: {
        today: leadsToday || 0,
        week: leadsWeek || 0,
        total: totalLeads || 0,
        converted: convertedLeads || 0,
        conversionRate: totalLeads > 0
          ? ((convertedLeads / totalLeads) * 100).toFixed(1)
          : '0.0',
      },
      clients: {
        active: activeClients || 0,
        byProgram: programCounts,
      },
      checkins: {
        pending: pendingCheckins,
        doneThisWeek: checkinsDone || 0,
      },
      programs: {
        generatedThisWeek: programsGenerated || 0,
      },
      escalations: escalations || [],
      recentLeads: recentLeads || [],
      recentClients: recentClients || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
