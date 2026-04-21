const { getSupabase } = require('../lib/supabase');
const { json, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return json(res, { error: 'GET only' }, 405);

  const db = getSupabase();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      openEscalations,
      recentLeads,
      recentClients,
      recentEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact', head: false }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(15),
      db.from('clients').select('*').order('created_at', { ascending: false }).limit(15),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
    ]);

    const convertedCount = allLeads.data
      ? allLeads.data.filter((l) => l.status === 'converted').length
      : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0
      ? ((convertedCount / totalLeads) * 100).toFixed(1)
      : 0;

    const programBreakdown = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      }
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!existing || existing.length === 0) pendingCheckinCount++;
      }
    }

    return json(res, {
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      program_breakdown: programBreakdown,
      pending_checkins: pendingCheckinCount,
      programs_generated_week: programsWeek.count || 0,
      open_escalations: (openEscalations.data || []).length,
      recent_leads: (recentLeads.data || []).map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone ? l.phone.slice(0, 4) + '***' + l.phone.slice(-3) : '***',
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      })),
      recent_clients: (recentClients.data || []).map((c) => ({
        id: c.id,
        name: c.name,
        program: c.program,
        status: c.status,
        program_started_at: c.program_started_at,
        paid_amount: c.paid_amount,
      })),
      escalations: (recentEscalations.data || []).map((e) => ({
        id: e.id,
        reason: e.reason,
        phone: e.phone ? e.phone.slice(0, 4) + '***' + e.phone.slice(-3) : '***',
        source_type: e.source_type,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
