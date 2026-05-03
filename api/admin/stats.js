const { getSupabase } = require('../lib/supabase');
const { corsHeaders, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return json(res, { error: 'GET only' }, 405);

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json(res, { error: 'unauthorized' }, 401);
  }
  const token = authHeader.split(' ')[1];
  const sb = getSupabase();

  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return json(res, { error: 'unauthorized' }, 401);

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
      escalations
    ] = await Promise.all([
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      sb.from('leads').select('id, status', { count: 'exact' }),
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('clients').select('program, status').eq('status', 'active'),
      sb.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      sb.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      sb.from('messages').select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .like('body', '%ESCALATION%')
        .gte('sent_at', weekStart)
        .order('sent_at', { ascending: false })
        .limit(20)
    ]);

    const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;

    const programBreakdown = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      }
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const expectedWeek = Math.ceil(daysSinceStart / 7);
        if (expectedWeek < 1) continue;

        const { data: latestCheckin } = await sb
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        if (!latestCheckin || latestCheckin.week_no < expectedWeek) {
          pendingCount++;
        }
      }
    }

    return json(res, {
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programBreakdown,
      pending_checkins: pendingCount,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: (escalations.data || []).map(e => ({
        phone: e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3),
        body: e.body ? e.body.slice(0, 200) : '',
        sent_at: e.sent_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
