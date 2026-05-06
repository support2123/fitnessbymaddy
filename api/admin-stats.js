const { getSupabase } = require('./_lib/supabase');
const { jsonResponse, errorResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return errorResponse(res, 'GET only', 405);

  // Basic auth check (use Supabase Auth token or simple API key)
  const authHeader = req.headers['authorization'] || '';
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && authHeader !== `Bearer ${adminKey}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Parallel queries
  const [
    leadsToday,
    leadsWeek,
    totalLeads,
    convertedLeads,
    activeClients,
    clientsByProgram,
    pendingCheckins,
    programsThisWeek,
    openEscalations,
    recentMessages
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),
    db.from('leads').select('id', { count: 'exact', head: true })
      .gte('created_at', weekStart.toISOString()),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true })
      .eq('status', 'converted'),
    db.from('clients').select('id, program, name, phone, status')
      .eq('status', 'active'),
    db.from('clients').select('program')
      .eq('status', 'active'),
    db.from('clients').select('id, name, phone, program, program_started_at')
      .eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true })
      .gte('generated_at', weekStart.toISOString()),
    db.from('escalations').select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('messages').select('*')
      .order('sent_at', { ascending: false })
      .limit(50)
  ]);

  // Count clients by program
  const programCounts = {};
  if (clientsByProgram.data) {
    for (const c of clientsByProgram.data) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
  }

  // Calculate pending check-ins (active clients who haven't submitted this week)
  let pendingCount = 0;
  if (pendingCheckins.data) {
    for (const c of pendingCheckins.data) {
      const weekNo = Math.floor(
        (now.getTime() - new Date(c.program_started_at).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
      ) + 1;
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', c.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();
      if (!checkin) pendingCount++;
    }
  }

  const totalLeadsCount = totalLeads.count || 0;
  const convertedCount = convertedLeads.count || 0;

  return jsonResponse(res, {
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsWeek.count || 0,
    total_leads: totalLeadsCount,
    converted_leads: convertedCount,
    conversion_rate: totalLeadsCount > 0
      ? ((convertedCount / totalLeadsCount) * 100).toFixed(1) + '%'
      : '0%',
    active_clients: activeClients.data?.length || 0,
    clients_by_program: programCounts,
    pending_checkins: pendingCount,
    programs_generated_this_week: programsThisWeek.count || 0,
    open_escalations: openEscalations.data || [],
    recent_messages: (recentMessages.data || []).map(m => ({
      ...m,
      phone: m.phone ? m.phone.slice(0, 3) + 'XXX...' + m.phone.slice(-3) : ''
    }))
  });
};
