const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const db = getSupabase();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
      recentLeads,
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }),
      db.from('leads').select('id, phone, name, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('escalations').select('*').order('created_at', { ascending: false }).limit(10)
    ]);

    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : 0;

    const programBreakdown = {};
    (clientsByProgram.data || []).forEach(c => {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });

    const activePendingCheckins = [];
    for (const client of (pendingCheckins.data || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!existing) {
        activePendingCheckins.push({
          client_id: client.id,
          name: client.name,
          phone_masked: client.phone ? client.phone.slice(0, 3) + 'XXX...' + client.phone.slice(-3) : '***',
          program: client.program,
          week_no: currentWeek
        });
      }
    }

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: activePendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      open_escalations: (openEscalations.data || []).map(e => ({
        id: e.id,
        phone_masked: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
        reason: e.reason,
        message_body: (e.message_body || '').slice(0, 100),
        created_at: e.created_at
      })),
      recent_leads: (recentLeads.data || []).map(l => ({
        id: l.id,
        phone_masked: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : '***',
        name: l.name,
        status: l.status,
        program_interest: l.program_interest,
        created_at: l.created_at
      }))
    });

  } catch (err) {
    console.error('[admin-stats] Error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
