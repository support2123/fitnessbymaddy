const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) return res.status(401).json({ error: 'Auth required' });

  const db = getSupabase();

  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  try {
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
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program').eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingCheckinsList = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at || client.created_at);
        const daysSince = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSince / 7));

        const { data: checkin } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) {
          pendingCheckinsList.push({
            client_id: client.id,
            name: client.name,
            phone: maskForAdmin(client.phone),
            program: client.program,
            week_no: currentWeek
          });
        }
      }
    }

    const totalLeadsCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadsCount > 0
      ? ((convertedCount / totalLeadsCount) * 100).toFixed(1)
      : '0.0';

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeadsCount,
      conversion_rate: conversionRate,
      active_clients: activeClients.data?.length || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckinsList,
      programs_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(function(m) {
        return { body: m.body, sent_at: m.sent_at, phone: maskForAdmin(m.phone) };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function maskForAdmin(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + '****' + phone.slice(-3);
}
