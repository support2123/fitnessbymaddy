const { getSupabase } = require('../_lib/supabase');
const { corsHeaders } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      openEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, program, name, phone, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
    ]);

    const programCounts = {};
    for (const c of clientsByProgram.data || []) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const pendingList = [];
    for (const client of pendingCheckins.data || []) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24 * 7));
      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        pendingList.push({ client_id: client.id, name: client.name, week_no: weekNo });
      }
    }

    const totalLeads = allLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      converted,
      conversion_rate: Number(conversionRate),
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsWeek.count || 0,
      escalations: openEscalations.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
