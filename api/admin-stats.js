const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsWeek,
      escalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      db.from('clients').select('id, status', { count: 'exact' }),
      db.from('clients').select('id').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, body', { count: 'exact' })
        .eq('template_name', 'escalation_alert')
        .eq('status', 'sent')
        .gte('sent_at', weekStart)
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    const programBreakdown = {};
    if (activeClients.data) {
      for (const c of activeClients.data) {
        const p = c.program || 'unknown';
        programBreakdown[p] = (programBreakdown[p] || 0) + 1;
      }
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const { data: latestCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const { data: clientData } = await db
          .from('clients')
          .select('program_started_at')
          .eq('id', client.id)
          .single();

        if (clientData) {
          const startDate = new Date(clientData.program_started_at);
          const currentWeek = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
          const lastWeek = latestCheckin && latestCheckin.length > 0 ? latestCheckin[0].week_no : 0;
          if (currentWeek > lastWeek) pendingCheckinCount++;
        }
      }
    }

    const { data: recentLeads } = await db
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: recentClients } = await db
      .from('clients')
      .select('id, name, phone, program, status, paid_amount, program_started_at')
      .order('created_at', { ascending: false })
      .limit(10);

    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 3) + 'XXX...' + l.phone.slice(-3) : ''
    }));

    const maskedClients = (recentClients || []).map(c => ({
      ...c,
      phone: c.phone ? c.phone.slice(0, 3) + 'XXX...' + c.phone.slice(-3) : ''
    }));

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      total_clients: allClients.count || 0,
      programs_by_type: programBreakdown,
      pending_checkins: pendingCheckinCount,
      programs_generated_week: programsWeek.count || 0,
      escalations_week: escalations.count || 0,
      recent_leads: maskedLeads,
      recent_clients: maskedClients
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
