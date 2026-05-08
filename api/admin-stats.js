import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
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
      leadsThisWeek,
      allLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      escalations
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id, status', { count: 'exact' }),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program, status').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('id, phone, body, sent_at').eq('template_name', 'escalation_alert').gte('sent_at', weekStart).order('sent_at', { ascending: false }).limit(20)
    ]);

    const convertedCount = (allLeads.data || []).filter(l => l.status === 'converted').length;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    const programCounts = {};
    for (const c of (clientsByProgram.data || [])) {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    }

    const pendingList = [];
    for (const client of (pendingCheckins.data || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastCheckin || lastCheckin.week_no < currentWeek) {
        pendingList.push({
          id: client.id,
          name: client.name,
          program: client.program,
          currentWeek,
          lastSubmitted: lastCheckin?.week_no || 0
        });
      }
    }

    return res.status(200).json({
      ok: true,
      stats: {
        leads_today: leadsToday.count || 0,
        leads_this_week: leadsThisWeek.count || 0,
        conversion_rate: conversionRate,
        active_clients: activeClients.count || 0,
        clients_by_program: programCounts,
        pending_checkins: pendingList,
        programs_generated_this_week: programsThisWeek.count || 0,
        recent_escalations: (escalations.data || []).map(e => ({
          phone: e.phone.slice(0, 3) + 'XXX...' + e.phone.slice(-3),
          body: e.body.slice(0, 200),
          sent_at: e.sent_at
        }))
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
