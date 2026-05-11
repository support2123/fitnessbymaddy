const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
      recentEscalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, name, phone, program, status, program_started_at').eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(db),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('phone, body, sent_at').eq('direction', 'out').like('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10)
    ]);

    const programCounts = {};
    (clientsByProgram.data || []).forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const totalLeadCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadCount > 0 ? ((convertedCount / totalLeadCount) * 100).toFixed(1) : 0;

    return res.json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: totalLeadCount,
      converted_leads: convertedCount,
      conversion_rate: parseFloat(conversionRate),
      active_clients: (activeClients.data || []).length,
      active_clients_list: (activeClients.data || []).map(function(c) {
        return {
          id: c.id,
          name: c.name,
          program: c.program,
          started: c.program_started_at
        };
      }),
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(function(m) {
        return {
          phone: maskPhone(m.phone),
          body: (m.body || '').slice(0, 150),
          sent_at: m.sent_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};

async function getPendingCheckins(db) {
  const { data: activeClients } = await db
    .from('clients')
    .select('id, name, phone, program, program_started_at')
    .eq('status', 'active');

  if (!activeClients) return [];

  var pending = [];
  var now = new Date();

  for (var i = 0; i < activeClients.length; i++) {
    var client = activeClients[i];
    var startDate = new Date(client.program_started_at);
    var daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    var expectedWeek = Math.floor(daysSince / 7) + 1;

    var { data: lastCheckin } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    var lastWeek = lastCheckin ? lastCheckin.week_no : 0;
    if (lastWeek < expectedWeek) {
      pending.push({
        client_id: client.id,
        name: client.name,
        expected_week: expectedWeek,
        last_submitted_week: lastWeek
      });
    }
  }

  return pending;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}
