const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, phone, name, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('phone, body, sent_at')
        .eq('direction', 'out')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10),
      db.from('leads').select('id, phone, name, status, program_interest, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const currentWeek = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / (7 * 86400000)));
        const { count } = await db
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .eq('week_no', currentWeek);
        if (!count || count === 0) pendingCount++;
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const totalConverted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      leads_total: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(function(e) {
        return {
          phone: e.phone ? e.phone.substring(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
          body: (e.body || '').substring(0, 100),
          sent_at: e.sent_at,
        };
      }),
      recent_leads: (recentLeads.data || []).map(function(l) {
        return {
          id: l.id,
          name: l.name || 'Unknown',
          phone: l.phone ? l.phone.substring(0, 3) + 'XXX...' + l.phone.slice(-3) : '***',
          status: l.status,
          program_interest: l.program_interest,
          created_at: l.created_at,
        };
      }),
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
