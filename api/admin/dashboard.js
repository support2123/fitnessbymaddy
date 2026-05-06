const { getSupabase } = require('../../lib/supabase');
const { handleOptions } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      allLeads,
      convertedLeads,
      activeClients,
      pendingCheckins,
      programsWeek,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('id, program, status').eq('status', 'active'),
      supabase.from('clients').select('id, phone, name, program').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekAgo),
    ]);

    const clientsByProgram = {};
    for (const c of activeClients.data || []) {
      clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
    }

    // Find clients with pending check-ins (active, no check-in this week)
    const pendingList = [];
    for (const client of pendingCheckins.data || []) {
      const { data: latestCheckin } = await supabase
        .from('checkins')
        .select('form_submitted_at')
        .eq('client_id', client.id)
        .order('form_submitted_at', { ascending: false })
        .limit(1)
        .single();

      if (!latestCheckin || new Date(latestCheckin.form_submitted_at) < new Date(weekAgo)) {
        pendingList.push({
          id: client.id,
          name: client.name,
          program: client.program,
        });
      }
    }

    // Recent escalations (messages with escalation templates)
    const { data: escalations } = await supabase
      .from('messages')
      .select('*')
      .eq('template_name', 'escalation_alert')
      .gte('sent_at', weekAgo)
      .order('sent_at', { ascending: false })
      .limit(10);

    const totalLeads = allLeads.count || 0;
    const totalConverted = convertedLeads.count || 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      conversion_rate: totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : '0.0',
      active_clients: (activeClients.data || []).length,
      clients_by_program: clientsByProgram,
      pending_checkins: pendingList,
      programs_generated_this_week: programsWeek.count || 0,
      escalations: (escalations || []).map(e => ({
        body: e.body,
        sent_at: e.sent_at,
      })),
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
