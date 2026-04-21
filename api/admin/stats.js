const { getSupabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: leadsToday },
    { count: leadsWeek },
    { data: allLeads },
    { data: activeClients },
    { count: programsThisWeek },
    { data: recentLeads },
    { data: escalationMessages },
  ] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id, status'),
    db.from('clients').select('id, program, name, phone, status').eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
    db.from('messages').select('*').eq('template_name', 'escalation_alert').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(10),
  ]);

  const total = allLeads?.length || 0;
  const converted = allLeads?.filter(l => l.status === 'converted').length || 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  const programCounts = {};
  (activeClients || []).forEach(c => {
    programCounts[c.program] = (programCounts[c.program] || 0) + 1;
  });

  return res.status(200).json({
    leadsToday: leadsToday || 0,
    leadsWeek: leadsWeek || 0,
    conversionRate,
    activeClients: activeClients?.length || 0,
    programsThisWeek: programsThisWeek || 0,
    programCounts,
    recentLeads: (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 4) + 'XXX...' + l.phone.slice(-3) : null,
    })),
    escalations: escalationMessages || [],
  });
};
