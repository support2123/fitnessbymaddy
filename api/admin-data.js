const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Auth required' });

  try {
    const db = getSupabase();

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      activeClients,
      allClients,
      pendingCheckins,
      programsWeek,
      recentEscalations,
      clientsByProgram,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('clients').select('*').eq('status', 'active'),
      db.from('clients').select('id', { count: 'exact', head: true }),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('template_name', 'escalation').order('sent_at', { ascending: false }).limit(10),
      db.from('clients').select('program').eq('status', 'active'),
    ]);

    const convertedLeads = await db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted');

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
        const daysSince = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSince / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          pendingList.push({
            id: client.id,
            name: client.name,
            phone: client.phone ? client.phone.slice(0, 4) + 'XXX...' + client.phone.slice(-3) : '',
            program: client.program,
            week: currentWeek,
          });
        }
      }
    }

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.data ? activeClients.data.length : 0,
      total_clients: allClients.count || 0,
      programs_generated_week: programsWeek.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingList,
      escalations: (recentEscalations.data || []).map(function(e) {
        return {
          phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '',
          body: e.body,
          sent_at: e.sent_at,
        };
      }),
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
