const { getSupabase } = require('../_lib/supabase');
const { cors } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
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
      convertedLeads,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, phone, name, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .like('template_name', '%escalation%')
        .gte('sent_at', weekStart)
        .order('sent_at', { ascending: false })
        .limit(20),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingCount = 0;
    const pendingList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.floor(
          (now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;
        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!checkin) {
          pendingCount++;
          pendingList.push({ name: client.name, phone: client.phone, week: weekNo });
        }
      }
    }

    const totalLeads = allLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      pending_checkins_list: pendingList.slice(0, 10),
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (escalations.data || []).map(e => ({
        phone: e.phone,
        body: e.body ? e.body.slice(0, 100) : '',
        sent_at: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
