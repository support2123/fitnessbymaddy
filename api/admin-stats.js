import { getSupabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
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
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
      db.from('leads').select('id, name, phone, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('id, name, phone, program, status, program_started_at, paid_amount').order('program_started_at', { ascending: false }).limit(20)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(function(c) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      });
    }

    let pendingCheckinCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: existing } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!existing) pendingCheckinCount++;
      }
    }

    const totalLeads = leadsTotal.count || 0;
    const totalConverted = convertedTotal.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      leads_total: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCheckinCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      recent_escalations: (recentEscalations.data || []).map(function(e) {
        return { id: e.id, body: e.body, sent_at: e.sent_at };
      }),
      recent_leads: (recentLeads.data || []).map(function(l) {
        return { id: l.id, name: l.name, status: l.status, program_interest: l.program_interest, created_at: l.created_at };
      }),
      recent_clients: (recentClients.data || []).map(function(c) {
        return { id: c.id, name: c.name, program: c.program, status: c.status, paid_amount: c.paid_amount, started: c.program_started_at };
      })
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
