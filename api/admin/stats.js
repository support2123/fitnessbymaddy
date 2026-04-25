const { getSupabase } = require('../lib/supabase');
const { handleCors, jsonError, jsonOk } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return jsonError(res, 'Unauthorized', 401);
  }

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
    recentLeads,
    pendingCheckins,
    recentPrograms,
    escalations,
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('*').eq('status', 'active').order('created_at', { ascending: false }),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    getPendingCheckins(db, now),
    db.from('programs').select('*, clients(name)').gte('generated_at', weekStart).order('generated_at', { ascending: false }).limit(20),
    db.from('messages').select('*').eq('template_name', 'escalation_alert').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(10),
  ]);

  const programCounts = {};
  (clientsByProgram.data || []).forEach(c => {
    programCounts[c.program] = (programCounts[c.program] || 0) + 1;
  });

  const total = totalLeads.count || 0;
  const converted = convertedLeads.count || 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  const programsWithNames = (recentPrograms.data || []).map(p => ({
    ...p,
    client_name: p.clients?.name || null,
  }));

  return jsonOk(res, {
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: conversionRate,
    active_count: (activeClients.data || []).length,
    by_program: programCounts,
    pending_checkins_count: pendingCheckins.length,
    programs_week: (recentPrograms.data || []).length,
    escalation_count: (escalations.data || []).length,
    recent_leads: recentLeads.data || [],
    active_clients: activeClients.data || [],
    pending_checkins: pendingCheckins,
    recent_programs: programsWithNames,
    escalations: escalations.data || [],
  });
};

async function getPendingCheckins(db, now) {
  const { data: clients } = await db
    .from('clients')
    .select('id, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return [];

  const pending = [];

  for (const client of clients) {
    const start = new Date(client.program_started_at);
    const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSince / 7);
    if (weekNo < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id, form_submitted_at')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    pending.push({
      client_id: client.id,
      client_name: client.name,
      week_no: weekNo,
      form_submitted_at: checkin?.form_submitted_at || null,
    });
  }

  return pending.filter(p => !p.form_submitted_at);
}
