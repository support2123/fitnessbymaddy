const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*')
        .eq('direction', 'out')
        .ilike('template_name', '%escalation%')
        .order('sent_at', { ascending: false })
        .limit(10)
    ]);

    const programCounts = {};
    for (const c of (clientsByProgram.data || [])) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0
      ? ((totalConverted / totalLeads) * 100).toFixed(1)
      : '0.0';

    // Calculate pending check-ins
    let pendingCount = 0;
    for (const client of (pendingCheckins.data || [])) {
      const weekNo = calculateWeekNo(client.program_started_at || new Date().toISOString());
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();
      if (!checkin) pendingCount++;
    }

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: totalLeads,
        converted: totalConverted,
        conversion_rate: conversionRate + '%'
      },
      clients: {
        active: (activeClients.data || []).length,
        by_program: programCounts
      },
      checkins: {
        pending: pendingCount
      },
      programs: {
        generated_this_week: programsThisWeek.count || 0
      },
      escalations: (recentEscalations.data || []).map(e => ({
        phone: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
        body: e.body,
        sent_at: e.sent_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}
