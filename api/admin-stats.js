const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = getSupabase();

  const { data: user, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [leadsToday, leadsWeek, totalLeads, converted, activeClients, checkins, programs, escalations] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('checkins').select('id', { count: 'exact', head: true }).gte('form_submitted_at', weekStart),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('id', { count: 'exact', head: true }).eq('template_name', 'escalation_alert').gte('sent_at', weekStart),
  ]);

  const total = totalLeads.count || 0;
  const conv = converted.count || 0;
  const rate = total > 0 ? Math.round((conv / total) * 100) : 0;

  return res.status(200).json({
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: rate,
    active_clients: activeClients.count || 0,
    pending_checkins: checkins.count || 0,
    programs_week: programs.count || 0,
    escalations: escalations.count || 0,
  });
};
