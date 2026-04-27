const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && authHeader !== `Bearer ${adminKey}`) {
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
      openEscalations,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, phone, name, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = Math.ceil(
          (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weekNo < 1) continue;
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!existing) pendingCount++;
      }
    }

    const total = totalLeads.count || 0;
    const converted = convertedLeads.count || 0;
    const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsThisWeek.count || 0,
      total_leads: total,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (openEscalations.data || []).map(e => ({
        id: e.id,
        reason: e.reason,
        phone: e.phone ? e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3) : '***',
        created_at: e.created_at,
        message_body: e.message_body ? e.message_body.substring(0, 100) : null,
      })),
    });

  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
