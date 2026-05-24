const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [leadsToday, leadsWeek, allLeads, activeClients, programsWeek, pendingCheckins] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id, program').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('clients').select('id, program_started_at').eq('status', 'active')
    ]);

    const totalLeads = allLeads.count || 0;
    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100) : 0;

    const byProgram = {};
    (activeClients.data || []).forEach(c => {
      byProgram[c.program] = (byProgram[c.program] || 0) + 1;
    });

    return res.status(200).json({
      ok: true,
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: (activeClients.data || []).length,
      pending_checkins: calculatePendingCheckins(pendingCheckins.data || []),
      programs_week: programsWeek.count || 0,
      by_program: byProgram
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculatePendingCheckins(clients) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0) return clients.length;
  return 0;
}
