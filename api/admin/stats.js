const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const db = getSupabase();

  const { data: user, error: authError } = await db.auth.getUser(token);
  if (authError || !user?.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

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
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('escalations').select('id, phone, reason, message_body, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
  ]);

  const programCounts = {};
  if (clientsByProgram.data) {
    clientsByProgram.data.forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });
  }

  let pendingCount = 0;
  if (pendingCheckins.data) {
    for (const client of pendingCheckins.data) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 86400000));
      if (weekNo >= 1) {
        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();
        if (!checkin) pendingCount++;
      }
    }
  }

  const totalLeadsCount = totalLeads.count || 0;
  const convertedCount = convertedLeads.count || 0;
  const conversionRate = totalLeadsCount > 0
    ? ((convertedCount / totalLeadsCount) * 100).toFixed(1)
    : '0.0';

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsWeek.count || 0,
    total_leads: totalLeadsCount,
    converted_leads: convertedCount,
    conversion_rate: parseFloat(conversionRate),
    active_clients: activeClients.count || 0,
    clients_by_program: programCounts,
    pending_checkins: pendingCount,
    programs_generated_this_week: programsThisWeek.count || 0,
    escalations: openEscalations.data || [],
  });
};
