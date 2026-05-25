const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      { count: leadsToday },
      { count: leadsWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { count: activeClients },
      { data: programsThisWeek },
      { data: escalations },
      { data: recentLeads },
      { data: clientsByProgram },
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('programs').select('client_id, week_no, generated_at, whatsapp_sent_at').gte('generated_at', weekAgo.toISOString()).order('generated_at', { ascending: false }).limit(20),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
      supabase.from('leads').select('name, phone, market, program_interest, status, created_at').order('created_at', { ascending: false }).limit(15),
      supabase.from('clients').select('program').eq('status', 'active'),
    ]);

    const convRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    const programCounts = {};
    if (clientsByProgram) {
      clientsByProgram.forEach((c) => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    return res.status(200).json({
      leads_today: leadsToday || 0,
      leads_week: leadsWeek || 0,
      conversion_rate: convRate,
      active_clients: activeClients || 0,
      programs_this_week: (programsThisWeek || []).length,
      escalations_pending: (escalations || []).length,
      program_breakdown: programCounts,
      recent_leads: (recentLeads || []).map((l) => ({
        ...l,
        phone: l.phone ? l.phone.slice(0, 4) + 'XXX...' + l.phone.slice(-3) : '***',
      })),
      escalations: (escalations || []).map((e) => ({
        ...e,
        phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '***',
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
