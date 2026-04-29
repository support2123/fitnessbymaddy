const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsWeek,
    allLeads,
    convertedLeads,
    activeClients,
    clientsByProgram,
    pendingCheckins,
    programsThisWeek,
    recentEscalations
  ] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    supabase.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
    supabase.from('clients').select('program').eq('status', 'active'),
    supabase.from('clients').select('id, name, phone, program_started_at').eq('status', 'active'),
    supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    supabase.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
  ]);

  const programCounts = {};
  if (clientsByProgram.data) {
    for (const c of clientsByProgram.data) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }
  }

  const pendingList = [];
  if (pendingCheckins.data) {
    for (const client of pendingCheckins.data) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (!checkin) {
        pendingList.push({ clientId: client.id, name: client.name, weekNo });
      }
    }
  }

  const totalLeads = allLeads.count || 0;
  const totalConverted = convertedLeads.count || 0;
  const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0';

  return res.status(200).json({
    leads: {
      today: leadsToday.count || 0,
      thisWeek: leadsWeek.count || 0,
      total: totalLeads,
      converted: totalConverted,
      conversionRate: conversionRate + '%'
    },
    clients: {
      active: activeClients.data?.length || 0,
      byProgram: programCounts,
      list: (activeClients.data || []).map(c => ({
        id: c.id,
        name: c.name,
        program: c.program,
        startedAt: c.program_started_at
      }))
    },
    pendingCheckins: pendingList,
    programsGenerated: programsThisWeek.count || 0,
    escalations: (recentEscalations.data || []).map(e => ({
      body: e.body,
      sentAt: e.sent_at
    }))
  });
};
