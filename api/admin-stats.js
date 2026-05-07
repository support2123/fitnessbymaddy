const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== process.env.SUPABASE_SERVICE_KEY && token !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid token' });
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
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      pendingEscalations,
      recentLeads,
      recentEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
      db.from('leads').select('id, phone, name, status, program_interest, market, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('escalations').select('*').order('created_at', { ascending: false }).limit(10),
    ]);

    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

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
        const weekNo = Math.ceil(daysSinceStart / 7);
        if (weekNo >= 1) {
          const { data: existing } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();
          if (!existing) pendingCheckinCount++;
        }
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCheckinCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      pending_escalations: (pendingEscalations.data || []).length,
      recent_leads: (recentLeads.data || []).map(l => ({
        ...l,
        phone: l.phone ? l.phone.slice(0, 4) + 'XXX...' + l.phone.slice(-3) : '***',
      })),
      escalations: (recentEscalations.data || []).map(e => ({
        ...e,
        phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '***',
      })),
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
