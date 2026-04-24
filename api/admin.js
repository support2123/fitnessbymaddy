const { getSupabase } = require('../lib/supabase');
const { json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsThisWeek,
    allLeads,
    allClients,
    activeClients,
    pendingCheckins,
    programsThisWeek,
    recentEscalations,
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('clients').select('id', { count: 'exact', head: true }),
    db.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
    db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
  ]);

  const programBreakdown = {};
  if (activeClients.data) {
    for (const c of activeClients.data) {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    }
  }

  let pendingCheckinList = [];
  if (pendingCheckins.data) {
    for (const client of pendingCheckins.data) {
      const startDate = new Date(client.program_started_at);
      const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSince / 7);

      const { data: latestCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = latestCheckin?.week_no || 0;
      if (lastWeek < currentWeek) {
        pendingCheckinList.push({
          client_id: client.id,
          name: client.name,
          program: client.program,
          current_week: currentWeek,
          last_submitted: lastWeek,
        });
      }
    }
  }

  const totalLeads = allLeads.count || 0;
  const totalClients = allClients.count || 0;
  const conversionRate = totalLeads > 0 ? ((totalClients / totalLeads) * 100).toFixed(1) : '0.0';

  return json(res, 200, {
    ok: true,
    stats: {
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeads,
      total_clients: totalClients,
      active_clients: activeClients.count || 0,
      conversion_rate: conversionRate + '%',
      programs_generated_this_week: programsThisWeek.count || 0,
    },
    active_by_program: programBreakdown,
    pending_checkins: pendingCheckinList,
    recent_escalations: (recentEscalations.data || []).map(e => ({
      body: e.body,
      sent_at: e.sent_at,
    })),
  });
};
