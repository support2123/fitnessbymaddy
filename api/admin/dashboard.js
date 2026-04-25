const { getSupabase } = require('../_lib/supabase');
const { handleCors } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  const adminKey = process.env.ADMIN_API_KEY || process.env.INTERNAL_API_KEY;
  if (adminKey && authHeader !== `Bearer ${adminKey}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at')
        .eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program')
        .eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true })
        .gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false })
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    let pendingCheckinList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.floor(
          (now - new Date(client.program_started_at || now)) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          pendingCheckinList.push({
            client_id: client.id,
            name: client.name,
            program: client.program,
            week_no: weekNo
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
      overview: {
        leads_today: leadsToday.count || 0,
        leads_this_week: leadsWeek.count || 0,
        total_leads: totalLeadCount,
        conversion_rate: `${conversionRate}%`,
        active_clients: activeClients.data ? activeClients.data.length : 0,
        programs_generated_this_week: programsThisWeek.count || 0
      },
      clients_by_program: programCounts,
      pending_checkins: pendingCheckinList,
      escalations: openEscalations.data || [],
      generated_at: now.toISOString()
    });
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
