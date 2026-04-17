const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      openEscalations,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const pending = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.floor((now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000));
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          pending.push({
            clientId: client.id,
            name: client.name,
            program: client.program,
            weekNo,
          });
        }
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0;

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        thisWeek: leadsWeek.count || 0,
        total: totalLeads,
        converted: totalConverted,
        conversionRate: parseFloat(conversionRate),
      },
      clients: {
        active: activeClients.count || 0,
        byProgram: programCounts,
      },
      pendingCheckins: pending,
      programsThisWeek: programsThisWeek.count || 0,
      escalations: openEscalations.data || [],
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
