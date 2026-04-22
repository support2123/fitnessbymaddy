const { getSupabase } = require('../_lib/supabase');
const { cors } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsWeek,
    leadsTotal,
    convertedTotal,
    clientsByProgram,
    activeClients,
    pendingCheckins,
    programsThisWeek,
    recentEscalations
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('program').eq('status', 'active'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('checkins').select('id', { count: 'exact', head: true }).is('form_submitted_at', null),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('*').eq('direction', 'in').ilike('body', '%refund%').order('sent_at', { ascending: false }).limit(10)
  ]);

  const programCounts = {};
  if (clientsByProgram.data) {
    for (const c of clientsByProgram.data) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
  }

  const totalLeads = leadsTotal.count || 0;
  const converted = convertedTotal.count || 0;
  const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

  return res.json({
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsWeek.count || 0,
    leads_total: totalLeads,
    conversion_rate: conversionRate,
    active_clients: activeClients.count || 0,
    clients_by_program: programCounts,
    pending_checkins: pendingCheckins.count || 0,
    programs_generated_this_week: programsThisWeek.count || 0,
    recent_escalations: (recentEscalations.data || []).map(m => ({
      phone: m.phone.slice(0, 4) + 'XXX...' + m.phone.slice(-3),
      body: m.body?.slice(0, 100),
      sent_at: m.sent_at
    }))
  });
};
