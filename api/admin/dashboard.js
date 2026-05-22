const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  try {
    const sb = getSupabase();
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await sb.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentMessages,
    ] = await Promise.all([
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      sb.from('leads').select('id', { count: 'exact', head: true }),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      sb.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      sb.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(sb),
      sb.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      sb.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      sb.from('messages').select('*').order('sent_at', { ascending: false }).limit(50),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0;

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsThisWeek.count || 0,
        total: totalLeads,
        conversion_rate: `${conversionRate}%`,
      },
      clients: {
        active: activeClients.data?.length || 0,
        by_program: programCounts,
        list: (activeClients.data || []).map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone?.slice(0, 3) + 'XXX...' + (c.phone?.slice(-3) || ''),
          program: c.program,
          started: c.program_started_at,
        })),
      },
      checkins: {
        pending: pendingCheckins,
      },
      programs: {
        generated_this_week: programsThisWeek.count || 0,
      },
      escalations: (openEscalations.data || []).map(e => ({
        id: e.id,
        phone: e.phone?.slice(0, 3) + 'XXX...' + (e.phone?.slice(-3) || ''),
        trigger: e.trigger_keyword,
        message: e.message_body?.slice(0, 100),
        created_at: e.created_at,
      })),
      recent_messages: (recentMessages.data || []).map(m => ({
        phone: m.phone?.slice(0, 3) + 'XXX...' + (m.phone?.slice(-3) || ''),
        direction: m.direction,
        body: m.body?.slice(0, 100),
        template: m.template_name,
        sent_at: m.sent_at,
      })),
    });

  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function getPendingCheckins(sb) {
  const { data: clients } = await sb
    .from('clients')
    .select('id, name, phone, program_started_at')
    .eq('status', 'active');

  if (!clients) return [];

  const pending = [];
  for (const client of clients) {
    const weeksElapsed = Math.ceil(
      (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    if (weeksElapsed < 1) continue;

    const { data: checkin } = await sb
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weeksElapsed)
      .maybeSingle();

    if (!checkin) {
      pending.push({
        client_id: client.id,
        name: client.name,
        week_no: weeksElapsed,
      });
    }
  }

  return pending;
}
