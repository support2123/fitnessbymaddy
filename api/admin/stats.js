const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentMessages
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('phone, body, sent_at').eq('direction', 'in')
        .or('body.ilike.%refund%,body.ilike.%injury%,body.ilike.%pain%,body.ilike.%medical%,body.ilike.%complaint%')
        .order('sent_at', { ascending: false }).limit(10),
      db.from('messages').select('phone, direction, body, sent_at')
        .order('sent_at', { ascending: false }).limit(20)
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
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) {
          pendingList.push({ client_id: client.id, name: client.name, program: client.program, week: currentWeek });
        }
      }
    }

    const totalLeadsCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadsCount > 0 ? ((convertedCount / totalLeadsCount) * 100).toFixed(1) : '0';

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsThisWeek.count || 0,
        total: totalLeadsCount,
        converted: convertedCount,
        conversion_rate: `${conversionRate}%`
      },
      clients: {
        active: activeClients.data?.length || 0,
        by_program: programCounts,
        list: (activeClients.data || []).map(c => ({
          id: c.id,
          name: c.name,
          program: c.program,
          started: c.program_started_at
        }))
      },
      pending_checkins: pendingList,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(e => ({
        phone: e.phone?.slice(0, 3) + 'XXX...' + (e.phone?.slice(-3) || ''),
        message: e.body?.slice(0, 100),
        time: e.sent_at
      })),
      recent_messages: (recentMessages.data || []).map(m => ({
        phone: m.phone?.slice(0, 3) + 'XXX...' + (m.phone?.slice(-3) || ''),
        direction: m.direction,
        body: m.body?.slice(0, 80),
        time: m.sent_at
      }))
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
