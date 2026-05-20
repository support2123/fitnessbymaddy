const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Stats
    const { count: leadsToday } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    const { count: leadsThisWeek } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    const { count: totalLeads } = await supabase
      .from('leads').select('*', { count: 'exact', head: true });

    const { count: convertedLeads } = await supabase
      .from('leads').select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    const { count: activeClients } = await supabase
      .from('clients').select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: programsThisWeek } = await supabase
      .from('programs').select('*', { count: 'exact', head: true })
      .gte('generated_at', weekStart);

    // Recent leads (last 20)
    const { data: recentLeads } = await supabase
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    // Mask phone numbers
    const maskedLeads = (recentLeads || []).map(l => ({
      ...l,
      phone: l.phone ? l.phone.slice(0, 5) + '...' + l.phone.slice(-3) : '***'
    }));

    // Active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at, status')
      .eq('status', 'active')
      .order('program_started_at', { ascending: false });

    // Get last check-in for each active client
    const clientsWithCheckins = [];
    for (const client of (clients || [])) {
      const weekNo = Math.ceil((now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000));
      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      clientsWithCheckins.push({
        ...client,
        phone: client.phone ? client.phone.slice(0, 5) + '...' + client.phone.slice(-3) : '***',
        current_week: weekNo,
        last_checkin_week: lastCheckin?.[0]?.week_no || 0,
        last_checkin_at: lastCheckin?.[0]?.form_submitted_at || null,
        checkin_pending: !lastCheckin?.[0] || lastCheckin[0].week_no < weekNo
      });
    }

    // Escalation messages (last 100 inbound, filtered by keywords)
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'in')
      .order('sent_at', { ascending: false })
      .limit(100);

    const ESCALATION_KEYWORDS = [
      'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
      'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
      'dizziness', 'dizzy', 'eating disorder', 'medical'
    ];

    const escalations = (recentMessages || [])
      .filter(m => {
        const lower = (m.body || '').toLowerCase();
        return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
      })
      .slice(0, 20)
      .map(m => ({
        ...m,
        phone: m.phone ? m.phone.slice(0, 5) + '...' + m.phone.slice(-3) : '***'
      }));

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    const pendingCheckins = clientsWithCheckins.filter(c => c.checkin_pending).length;

    return res.json({
      stats: {
        leads_today: leadsToday || 0,
        leads_this_week: leadsThisWeek || 0,
        conversion_rate: conversionRate,
        active_clients: activeClients || 0,
        pending_checkins: pendingCheckins,
        programs_this_week: programsThisWeek || 0
      },
      recent_leads: maskedLeads,
      active_clients: clientsWithCheckins,
      escalations
    });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
