const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClientsData,
      pendingCheckinsCount,
      programsThisWeek,
      recentLeads,
      escalationMessages
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact' }),
      supabase.from('leads').select('id', { count: 'exact' }).eq('status', 'converted'),
      supabase.from('clients').select('program, id').eq('status', 'active'),
      supabase.from('clients').select('id, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekStart),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10)
    ]);

    const clientsByProgram = {};
    if (activeClientsData.data) {
      for (const c of activeClientsData.data) {
        clientsByProgram[c.program || 'unknown'] = (clientsByProgram[c.program || 'unknown'] || 0) + 1;
      }
    }

    let pendingCheckins = 0;
    if (pendingCheckinsCount.data) {
      for (const client of pendingCheckinsCount.data) {
        const weekNo = calculateCurrentWeek(client.program_started_at);
        if (weekNo > 0) {
          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();
          if (!checkin) pendingCheckins++;
        }
      }
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients: activeClientsData.data ? activeClientsData.data.length : 0,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek.count || 0,
      clients_by_program: clientsByProgram,
      recent_leads: recentLeads.data || [],
      escalations: escalationMessages.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
