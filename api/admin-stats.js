const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

    // Leads today
    const { count: leadsToday } = await db
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Leads this week
    const { count: leadsWeek } = await db
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Total leads
    const { count: leadsTotal } = await db
      .from('leads')
      .select('*', { count: 'exact', head: true });

    // Converted leads
    const { count: converted } = await db
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    // Active clients by program
    const { data: clientsByProgram } = await db
      .from('clients')
      .select('program, status')
      .eq('status', 'active');

    const programCounts = {};
    (clientsByProgram || []).forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    // Total active clients
    const { count: activeClients } = await db
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Pending checkins this week (active clients minus those who submitted)
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('client_id')
      .gte('form_submitted_at', weekStart);

    const submittedIds = new Set((recentCheckins || []).map(c => c.client_id));
    const pendingCheckins = (activeClients || 0) - submittedIds.size;

    // Programs generated this week
    const { count: programsGenerated } = await db
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Messages today
    const { count: messagesToday } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('sent_at', todayStart);

    // Recent escalations (messages to Maddy's number containing "ESCALATION")
    const { data: escalations } = await db
      .from('messages')
      .select('body, sent_at, phone')
      .eq('direction', 'out')
      .like('body', 'ESCALATION%')
      .order('sent_at', { ascending: false })
      .limit(10);

    // Recent leads
    const { data: recentLeads } = await db
      .from('leads')
      .select('id, phone, name, status, program_interest, created_at, market')
      .order('created_at', { ascending: false })
      .limit(15);

    // Mask phone numbers
    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 6) + '***' + l.phone.slice(-2) : '***'
    }));

    const conversionRate = leadsTotal > 0
      ? ((converted / leadsTotal) * 100).toFixed(1)
      : '0.0';

    return res.json({
      leads: {
        today: leadsToday || 0,
        this_week: leadsWeek || 0,
        total: leadsTotal || 0,
        conversion_rate: conversionRate + '%'
      },
      clients: {
        active: activeClients || 0,
        by_program: programCounts
      },
      checkins: {
        pending: Math.max(0, pendingCheckins),
        submitted_this_week: submittedIds.size
      },
      programs_generated_this_week: programsGenerated || 0,
      messages_today: messagesToday || 0,
      escalations: (escalations || []).map(e => ({
        body: e.body?.slice(0, 200),
        sent_at: e.sent_at
      })),
      recent_leads: maskedLeads
    });

  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
