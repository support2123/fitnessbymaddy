const { getSupabase } = require('../lib/supabase');
const { jsonResponse, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const [leadsToday, leadsWeek, totalLeads, convertedLeads, activeClients, programsWeek] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    supabase.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
    supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart.toISOString()),
  ]);

  const activeClientsList = activeClients.data || [];
  const breakdown = {};
  activeClientsList.forEach(c => {
    breakdown[c.program] = (breakdown[c.program] || 0) + 1;
  });

  const total = totalLeads.count || 0;
  const converted = convertedLeads.count || 0;
  const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);

  const { data: activeForCheckin } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  let pendingCheckins = 0;
  if (activeForCheckin) {
    for (const client of activeForCheckin) {
      const start = new Date(client.program_started_at);
      const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSince / 7));
      const { count } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .eq('week_no', weekNo);
      if (!count) pendingCheckins++;
    }
  }

  return jsonResponse(res, 200, {
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: rate,
    active_clients: activeClients.count || 0,
    pending_checkins: pendingCheckins,
    programs_week: programsWeek.count || 0,
    program_breakdown: breakdown,
  });
};
