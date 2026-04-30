const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday, leadsWeek, allLeads,
      activeClients, allClients,
      pendingCheckins, programsWeek,
      recentEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      db.from('leads').select('id', { count: 'exact', head: true }),

      db.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      db.from('clients').select('id', { count: 'exact', head: true }),

      db.from('clients').select('id, name, phone, program, program_started_at')
        .eq('status', 'active'),

      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekAgo),

      db.from('messages').select('id, phone, body, sent_at')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const convertedCount = await db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'converted');

    const totalLeads = allLeads.count || 0;
    const converted = convertedCount.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    const programBreakdown = {};
    if (activeClients.data) {
      for (const c of activeClients.data) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      }
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;
        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);
        if (!checkin || checkin.length === 0) pendingCheckinCount++;
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      total_clients: allClients.count || 0,
      program_breakdown: programBreakdown,
      pending_checkins: pendingCheckinCount,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(e => ({
        phone: maskPhoneForAdmin(e.phone),
        body: e.body,
        time: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('admin-stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  return Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7)) + 1;
}

function maskPhoneForAdmin(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 6) + '...' + phone.slice(-2);
}
