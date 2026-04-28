const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsThisWeek,
      allLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsThisWeek,
      recentLeads,
      clientsByProgram,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('clients').select('program, status').eq('status', 'active'),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    const convertedCount = allClients.count || 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0.0';

    const pendingCheckinClients = [];
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = calculateCurrentWeek(client.program_started_at);
        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!checkin) {
          pendingCheckinClients.push({
            id: client.id,
            name: client.name,
            program: client.program,
            weekNo,
          });
        }
      }
    }

    const escalationKeywords = ['refund', 'pain', 'injury', 'complaint', 'lawyer', 'side effect'];
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'in')
      .order('sent_at', { ascending: false })
      .limit(100);

    const escalations = (recentMessages || []).filter(m =>
      escalationKeywords.some(k => (m.body || '').toLowerCase().includes(k))
    ).slice(0, 10);

    return res.status(200).json({
      leadsToday: leadsToday.count || 0,
      leadsThisWeek: leadsThisWeek.count || 0,
      totalLeads,
      activeClients: activeClients.count || 0,
      conversionRate,
      programCounts,
      programsGenerated: programsThisWeek.count || 0,
      pendingCheckins: pendingCheckinClients,
      recentLeads: (recentLeads.data || []).map(l => ({
        ...l,
        phone: maskPhone(l.phone),
      })),
      escalations: escalations.map(e => ({
        ...e,
        phone: maskPhone(e.phone),
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.max(1, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}
