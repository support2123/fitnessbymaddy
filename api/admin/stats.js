const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsWeek,
      openEscalations,
      clientsByProgram
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('id, status', { count: 'exact' }),
      getPendingCheckins(),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('program').eq('status', 'active')
    ]);

    const convertedCount = allLeads.data?.filter(l => l.status === 'converted').length || 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    const programBreakdown = {};
    (clientsByProgram.data || []).forEach(function(c) {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });

    const recentLeads = await supabase
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(15);

    const recentClients = await supabase
      .from('clients')
      .select('id, name, phone, program, status, program_started_at, paid_amount')
      .order('created_at', { ascending: false })
      .limit(15);

    return res.status(200).json({
      summary: {
        leads_today: leadsToday.count || 0,
        leads_this_week: leadsWeek.count || 0,
        total_leads: totalLeads,
        conversion_rate: conversionRate + '%',
        active_clients: activeClients.count || 0,
        total_clients: allClients.count || 0,
        pending_checkins: pendingCheckins,
        programs_generated_this_week: programsWeek.count || 0,
        open_escalations: openEscalations.data?.length || 0
      },
      clients_by_program: programBreakdown,
      escalations: (openEscalations.data || []).map(function(e) {
        return {
          id: e.id,
          phone: maskPhone(e.phone),
          reason: e.reason,
          created_at: e.created_at
        };
      }),
      recent_leads: (recentLeads.data || []).map(function(l) {
        return { ...l, phone: maskPhone(l.phone) };
      }),
      recent_clients: (recentClients.data || []).map(function(c) {
        return { ...c, phone: maskPhone(c.phone) };
      })
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckins() {
  const { data: activeClients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  let pending = 0;
  for (const client of activeClients || []) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();
    if (!data) pending++;
  }
  return pending;
}

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  return Math.ceil(Math.floor((now - start) / (1000 * 60 * 60 * 24)) / 7);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}
