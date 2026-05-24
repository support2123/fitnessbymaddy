const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: newLeads7d },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { count: checkins7d },
      { count: programs7d }
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('checkins').select('id', { count: 'exact', head: true }).gte('form_submitted_at', sevenDaysAgo),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', sevenDaysAgo)
    ]);

    const conversionRate = totalLeads > 0
      ? Math.round((convertedLeads / totalLeads) * 100)
      : 0;

    return res.status(200).json({
      new_leads_7d: newLeads7d || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients || 0,
      checkins_7d: checkins7d || 0,
      programs_7d: programs7d || 0,
      escalations: 0
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
