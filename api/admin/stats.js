const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now - 7 * 86400000).toISOString();

    const [
      { data: allLeads },
      { data: todayLeads },
      { data: weekLeads },
      { data: activeClients },
      { data: allClients },
      { data: weekPrograms },
      { data: openEscalations },
    ] = await Promise.all([
      supabase.from('leads').select('id, status'),
      supabase.from('leads').select('id').gte('created_at', todayStart),
      supabase.from('leads').select('id').gte('created_at', weekAgo),
      supabase.from('clients').select('id, program').eq('status', 'active'),
      supabase.from('clients').select('id'),
      supabase.from('programs').select('id').gte('generated_at', weekAgo),
      supabase.from('escalations').select('id').eq('resolved', false),
    ]);

    const converted = (allLeads || []).filter(l => l.status === 'converted').length;
    const totalLeads = (allLeads || []).length;
    const conversionRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

    const byProgram = {};
    (activeClients || []).forEach(c => {
      byProgram[c.program] = (byProgram[c.program] || 0) + 1;
    });

    return res.status(200).json({
      leadsToday: (todayLeads || []).length,
      leadsThisWeek: (weekLeads || []).length,
      conversionRate,
      activeClients: (activeClients || []).length,
      totalClients: (allClients || []).length,
      programsThisWeek: (weekPrograms || []).length,
      openEscalations: (openEscalations || []).length,
      byProgram,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
