const { getSupabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      clientsByProgram,
      pendingCheckins,
      programsWeek,
      escalations
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .like('template_name', 'escalation%')
        .gte('sent_at', weekStart)
        .order('sent_at', { ascending: false })
        .limit(20)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weeksSinceStart = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weeksSinceStart < 1) continue;

        const { data: latestCheckin } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeek = latestCheckin && latestCheckin.length > 0 ? latestCheckin[0].week_no : 0;
        if (lastWeek < weeksSinceStart) {
          pendingList.push({
            id: client.id,
            name: client.name,
            program: client.program,
            current_week: weeksSinceStart,
            last_submitted: lastWeek
          });
        }
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const totalConverted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      total_converted: totalConverted,
      conversion_rate: conversionRate + '%',
      active_clients_by_program: programCounts,
      active_clients_total: clientsByProgram.data ? clientsByProgram.data.length : 0,
      pending_checkins: pendingList,
      programs_generated_this_week: programsWeek.count || 0,
      recent_escalations: escalations.data || []
    });
  } catch (err) {
    console.error('[Admin Stats] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
