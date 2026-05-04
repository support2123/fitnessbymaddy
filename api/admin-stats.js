const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      escalations,
      convertedCount
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program').eq('status', 'active'),
      supabase.from('clients').select('id, phone, name, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted')
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    const pendingList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.ceil(
          (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!existing) {
          pendingList.push({
            client_id: client.id,
            name: client.name,
            phone: client.phone ? client.phone.slice(0, 3) + 'XXX...' + client.phone.slice(-3) : '***',
            program: client.program,
            week_no: weekNo
          });
        }
      }
    }

    const totalLeads = allLeads.count || 0;
    const converted = convertedCount.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate + '%',
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (escalations.data || []).map(function(e) {
        return {
          id: e.id,
          phone: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
          reason: e.reason,
          message: e.message_body ? e.message_body.substring(0, 200) : null,
          created_at: e.created_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
