const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { data: user, error } = await db.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const query = req.query.q;

  try {
    if (query === 'stats') {
      return res.status(200).json(await getStats(db));
    }
    if (query === 'leads') {
      const { data } = await db.from('leads').select('*').order('created_at', { ascending: false }).limit(50);
      return res.status(200).json({ data: data || [] });
    }
    if (query === 'clients') {
      const { data } = await db.from('clients').select('*').order('created_at', { ascending: false }).limit(50);
      return res.status(200).json({ data: data || [] });
    }
    if (query === 'checkins') {
      const { data } = await db.from('checkins')
        .select('*, clients(name)')
        .order('form_submitted_at', { ascending: false })
        .limit(30);
      const mapped = (data || []).map(c => ({
        ...c,
        client_name: c.clients?.name,
        submitted: !!c.form_submitted_at,
      }));
      return res.status(200).json({ data: mapped });
    }
    if (query === 'programs') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await db.from('programs')
        .select('*, clients(name)')
        .gte('generated_at', sevenDaysAgo)
        .order('generated_at', { ascending: false });
      const mapped = (data || []).map(p => ({
        ...p,
        client_name: p.clients?.name,
      }));
      return res.status(200).json({ data: mapped });
    }
    if (query === 'escalations') {
      const { data } = await db.from('escalations')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });
      return res.status(200).json({ data: data || [] });
    }

    return res.status(400).json({ error: 'Unknown query' });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getStats(db) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [leadsToday, leadsWeek, totalLeads, convertedLeads, activeClients, pendingCheckins, programsWeek, openEscalations] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('clients').select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('escalations').select('id', { count: 'exact', head: true }).eq('resolved', false),
  ]);

  const total = totalLeads.count || 0;
  const converted = convertedLeads.count || 0;
  const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

  return {
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: rate,
    active_clients: activeClients.count || 0,
    pending_checkins: pendingCheckins.count || 0,
    programs_week: programsWeek.count || 0,
    open_escalations: openEscalations.count || 0,
  };
}
