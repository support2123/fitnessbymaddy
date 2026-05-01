const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: activeClientsData },
      { data: escalations },
      { data: recentLeads },
      { data: recentPrograms },
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, program').eq('status', 'active'),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
      db.from('leads').select('phone, status, program_interest, created_at').order('created_at', { ascending: false }).limit(15),
      db.from('programs').select('client_id, week_no, whatsapp_sent_at, generated_at').order('generated_at', { ascending: false }).limit(10),
    ]);

    const clientsByProgram = {};
    for (const c of (activeClientsData || [])) {
      clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
    }

    const activeCount = activeClientsData ? activeClientsData.length : 0;
    const convRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    let pendingCheckins = 0;
    for (const c of (activeClientsData || [])) {
      const weeksSinceStart = 1;
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', c.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      if (!checkin) pendingCheckins++;
    }

    const { count: programsWeek } = await db
      .from('programs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    const programsWithClients = [];
    for (const p of (recentPrograms || [])) {
      const { data: client } = await db
        .from('clients')
        .select('name, phone')
        .eq('id', p.client_id)
        .single();
      programsWithClients.push({
        ...p,
        client_name: client?.name || null,
        client_phone: client?.phone || null,
      });
    }

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: convRate,
      active_clients: activeCount,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek || 0,
      clients_by_program: clientsByProgram,
      escalations: escalations || [],
      recent_leads: recentLeads || [],
      recent_programs: programsWithClients,
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
};
