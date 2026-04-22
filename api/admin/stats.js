const { getClient } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const sb = getClient();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

    // Run all queries in parallel
    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
    ] = await Promise.all([
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      sb.from('leads').select('id', { count: 'exact', head: true }),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('clients').select('program').eq('status', 'active'),
      sb.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      sb.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      sb.from('messages').select('phone, body, sent_at')
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(50),
      sb.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    // Compute program distribution
    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    // Find clients with pending check-ins this week
    const pendingList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) {
          pendingList.push({
            name: client.name,
            phone: client.phone,
            program: client.program,
            week: currentWeek,
          });
        }
      }
    }

    // Detect escalation messages
    const escalationKeywords = [
      'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
      'pain', 'injury', 'medical', 'pregnant',
    ];
    const escalations = [];
    if (recentEscalations.data) {
      for (const msg of recentEscalations.data) {
        const lower = (msg.body || '').toLowerCase();
        const matched = escalationKeywords.filter(kw => lower.includes(kw));
        if (matched.length > 0) {
          escalations.push({
            phone: msg.phone,
            body: msg.body,
            sent_at: msg.sent_at,
            flags: matched,
          });
        }
      }
    }

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0
      ? ((convertedCount / totalLeadCount) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: escalations.slice(0, 10),
      recent_leads: (recentLeads.data || []).map(l => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      })),
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
