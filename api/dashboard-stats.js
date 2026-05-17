const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: allLeads },
      { data: todayLeads },
      { data: weekLeads },
      { data: activeClients },
      { data: weekPrograms },
      { data: escalations }
    ] = await Promise.all([
      supabase.from('leads').select('id, status'),
      supabase.from('leads').select('id').gte('created_at', today + 'T00:00:00Z'),
      supabase.from('leads').select('id').gte('created_at', weekAgo),
      supabase.from('clients').select('id, program').eq('status', 'active'),
      supabase.from('programs').select('id').gte('generated_at', weekAgo),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10)
    ]);

    const converted = (allLeads || []).filter(l => l.status === 'converted').length;
    const total = (allLeads || []).length;

    const programBreakdown = {};
    (activeClients || []).forEach(c => {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });

    return res.status(200).json({
      leads_today: (todayLeads || []).length,
      leads_week: (weekLeads || []).length,
      conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
      active_clients: (activeClients || []).length,
      programs_week: (weekPrograms || []).length,
      program_breakdown: programBreakdown,
      escalations: escalations || []
    });
  } catch (err) {
    console.error('Dashboard stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
