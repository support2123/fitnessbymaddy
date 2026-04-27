const { getSupabase } = require('../lib/supabase');
const { json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return json(res, { error: 'GET only' }, 405);

  const db = getSupabase();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      leadsToday,
      leadsWeek,
      leadsAll,
      convertedAll,
      clientsByProgram,
      activeClients,
      pendingCheckins,
      programsThisWeek,
      escalations,
      recentLeads,
      recentClients,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('checkins').select('id', { count: 'exact', head: true }).is('form_submitted_at', null),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('programs').select('id, client_id, week_no, generated_at, clients!inner(name, phone)', { count: 'exact' }).eq('flagged_for_review', true),
      db.from('leads').select('id, phone, name, status, program_interest, market, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('id, name, phone, program, status, program_started_at, paid_amount').order('created_at', { ascending: false }).limit(20),
    ]);

    // Count clients by program
    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const totalLeads = leadsAll.count || 0;
    const totalConverted = convertedAll.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0;

    return json(res, {
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins.count || 0,
      programs_this_week: programsThisWeek.count || 0,
      escalations: escalations.data || [],
      escalation_count: escalations.count || 0,
      recent_leads: recentLeads.data || [],
      recent_clients: recentClients.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
