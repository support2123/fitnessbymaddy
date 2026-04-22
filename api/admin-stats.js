const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
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
      recentMessages
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('id, status', { count: 'exact' }),
      supabase.from('clients').select('id, program, name, phone, status').eq('status', 'active'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('*').order('sent_at', { ascending: false }).limit(20)
    ]);

    const clientsByProgram = {};
    if (activeClients.data) {
      activeClients.data.forEach(function(c) {
        clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
      });
    }

    const convertedCount = allLeads.data ? allLeads.data.filter(function(l) { return l.status === 'converted'; }).length : 0;
    const totalLeads = allLeads.count || 0;
    const conversionRate = totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0';

    const checkinsDue = [];
    if (pendingCheckins.data) {
      for (var i = 0; i < pendingCheckins.data.length; i++) {
        var client = pendingCheckins.data[i];
        var startDate = new Date(client.program_started_at);
        var daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        var weekNo = Math.ceil(daysSince / 7);
        if (weekNo >= 1) {
          var existing = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();
          if (!existing.data) {
            checkinsDue.push({ client_id: client.id, name: client.name, week_no: weekNo, program: client.program });
          }
        }
      }
    }

    const escalationKeywords = ['ESCALATION', 'FLAGGED'];
    const escalations = recentMessages.data ? recentMessages.data.filter(function(m) {
      return m.body && escalationKeywords.some(function(kw) { return m.body.includes(kw); });
    }) : [];

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.data ? activeClients.data.length : 0,
      total_clients: allClients.count || 0,
      clients_by_program: clientsByProgram,
      pending_checkins: checkinsDue,
      programs_generated_this_week: programsWeek.count || 0,
      escalations: escalations.length,
      recent_messages: recentMessages.data || []
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
