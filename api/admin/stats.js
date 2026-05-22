const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      recentLeads,
      programsByType,
      pendingCheckins,
      programsWeek,
      escalations,
      recentPrograms,
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(10),
      supabase.from('programs').select('*, clients(phone)').order('generated_at', { ascending: false }).limit(10),
    ]);

    const totalCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalCount > 0 ? Math.round((convertedCount / totalCount) * 100) : 0;

    const typeCounts = {};
    (programsByType.data || []).forEach(c => {
      typeCounts[c.program] = (typeCounts[c.program] || 0) + 1;
    });
    const programsArray = Object.entries(typeCounts).map(([program, count]) => ({ program, count }));

    let pendingCount = 0;
    (pendingCheckins.data || []).forEach(client => {
      const start = new Date(client.program_started_at);
      const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(days / 7);
      if (currentWeek >= 1) pendingCount++;
    });

    const recentProgramsData = (recentPrograms.data || []).map(p => ({
      week_no: p.week_no,
      generated_at: p.generated_at,
      whatsapp_sent_at: p.whatsapp_sent_at,
      phone: p.clients ? p.clients.phone : '',
    }));

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      pending_checkins: pendingCount,
      programs_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      programs_by_type: programsArray,
      escalations: escalations.data || [],
      recent_programs: recentProgramsData,
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ error: 'failed to load stats' });
  }
};
