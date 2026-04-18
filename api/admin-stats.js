const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
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

    // Converted leads
    const { count: leadsConverted } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: clientsByProgram } = await supabase
      .from('clients')
      .select('program, status')
      .eq('status', 'active');

    const programCounts = {};
    (clientsByProgram || []).forEach(function(c) {
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
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    var pendingCheckins = [];
    for (var client of allActive || []) {
      var startDate = new Date(client.program_started_at);
      var daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      var weekNo = Math.floor(daysSinceStart / 7) + 1;

      var { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        pendingCheckins.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          week_no: weekNo,
        });
      }
    }

    // Programs generated this week
    const { count: programsWeek } = await supabase
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent leads (last 10)
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // Recent messages (last 20)
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('phone, direction, body, template_name, sent_at')
      .order('sent_at', { ascending: false })
      .limit(20);

    // Mask phone numbers
    function mask(phone) {
      if (!phone || phone.length < 6) return '***';
      return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
    }

    const conversionRate = leadsTotal > 0 ? ((leadsConverted / leadsTotal) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      ok: true,
      stats: {
        leadsToday: leadsToday || 0,
        leadsWeek: leadsWeek || 0,
        leadsTotal: leadsTotal || 0,
        conversionRate: conversionRate + '%',
        activeClients: activeClients || 0,
        programsGeneratedWeek: programsWeek || 0,
        pendingCheckins: pendingCheckins.length,
      },
      programCounts,
      pendingCheckins,
      recentLeads: (recentLeads || []).map(function(l) {
        return { ...l, phone: mask(l.phone) };
      }),
      recentMessages: (recentMessages || []).map(function(m) {
        return { ...m, phone: mask(m.phone) };
      }),
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
