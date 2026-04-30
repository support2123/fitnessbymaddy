const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      leadsTotal,
      convertedTotal,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
      recentClients
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact' }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact' }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact' }),
      db.from('leads').select('id', { count: 'exact' }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact' }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      getPendingCheckins(db),
      db.from('programs').select('id', { count: 'exact' }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('*').order('program_started_at', { ascending: false }).limit(20)
    ]);

    const programCounts = {};
    (clientsByProgram.data || []).forEach(function(c) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });

    const conversionRate = leadsTotal.count > 0
      ? ((convertedTotal.count / leadsTotal.count) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      leads: {
        today: leadsToday.count || 0,
        this_week: leadsWeek.count || 0,
        total: leadsTotal.count || 0
      },
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckins,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(function(e) {
        return {
          body: e.body?.substring(0, 200),
          sent_at: e.sent_at
        };
      }),
      recent_leads: (recentLeads.data || []).map(function(l) {
        return {
          id: l.id,
          name: l.name,
          phone: maskPhone(l.phone),
          status: l.status,
          program_interest: l.program_interest,
          market: l.market,
          created_at: l.created_at
        };
      }),
      recent_clients: (recentClients.data || []).map(function(c) {
        return {
          id: c.id,
          name: c.name,
          program: c.program,
          status: c.status,
          paid_amount: c.paid_amount,
          program_started_at: c.program_started_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins(db) {
  const { data: activeClients } = await db
    .from('clients')
    .select('id, name, program_started_at, program')
    .eq('status', 'active');

  let pending = 0;
  for (const client of (activeClients || [])) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;
    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();
    if (!checkin) pending++;
  }
  return pending;
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-3);
}
