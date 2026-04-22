const { getSupabase } = require('../lib/supabase');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsWeek,
    leadsTotal,
    clientsActive,
    clientsByProgram,
    pendingCheckins,
    programsWeek,
    recentEscalations,
    conversionData,
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('clients').select('program, status').eq('status', 'active'),
    db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('direction', 'out').ilike('template_name', '%escalation%').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(10),
    db.from('leads').select('id, status', { count: 'exact', head: true }).eq('status', 'converted'),
  ]);

  const programCounts = {};
  if (clientsByProgram.data) {
    clientsByProgram.data.forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });
  }

  const totalLeads = leadsTotal.count || 0;
  const converted = conversionData.count || 0;
  const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsWeek.count || 0,
    leads_total: totalLeads,
    conversion_rate: conversionRate,
    active_clients: clientsActive.count || 0,
    clients_by_program: programCounts,
    pending_checkins: (pendingCheckins.data || []).length,
    programs_generated_week: programsWeek.count || 0,
    recent_escalations: (recentEscalations.data || []).map(function(m) {
      return { body: m.body, sent_at: m.sent_at };
    }),
  });
};
