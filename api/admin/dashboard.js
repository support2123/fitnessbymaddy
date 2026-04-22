const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      escalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, program, name, phone, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program')
        .eq('status', 'active')
        .not('id', 'in',
          `(SELECT client_id FROM checkins WHERE week_no = ${calculateCurrentWeekGlobal()})`
        ),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false })
        .limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const totalLeads = allLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      converted_leads: converted,
      conversion_rate: conversionRate + '%',
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins.data?.length || 0,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: (escalations.data || []).map(function(e) {
        return {
          phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : 'N/A',
          body: e.body,
          sent_at: e.sent_at,
        };
      }),
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeekGlobal() {
  return Math.ceil((Date.now() - new Date('2025-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));
}
