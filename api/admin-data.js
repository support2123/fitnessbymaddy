import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { table } = req.query;

  try {
    switch (table) {
      case 'stats':
        return res.status(200).json(await getStats());

      case 'leads':
        return res.status(200).json(await getLeads());

      case 'clients':
        return res.status(200).json(await getClients());

      case 'escalations':
        return res.status(200).json(await getEscalations());

      default:
        return res.status(400).json({ error: 'Invalid table parameter' });
    }
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoISO = weekAgo.toISOString();

  const [
    { count: leadsToday },
    { count: leadsWeek },
    { count: totalLeads },
    { count: convertedLeads },
    { data: activeClientsList },
    { count: programsWeek },
    { count: escalations }
  ] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayISO),
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgoISO),
    supabase.from('leads').select('*', { count: 'exact', head: true }),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
    supabase.from('clients').select('id, program').eq('status', 'active'),
    supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekAgoISO),
    supabase.from('messages').select('*', { count: 'exact', head: true })
      .eq('template_name', 'escalation_alert').gte('sent_at', weekAgoISO)
  ]);

  const activeCount = activeClientsList ? activeClientsList.length : 0;

  const programCounts = {};
  if (activeClientsList) {
    activeClientsList.forEach(c => {
      programCounts[c.program] = (programCounts[c.program] || 0) + 1;
    });
  }
  const breakdown = Object.entries(programCounts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const rate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  let pendingCheckins = 0;
  if (activeClientsList) {
    for (const client of activeClientsList) {
      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      // If no check-in this week, count as pending
      if (!lastCheckin) {
        pendingCheckins++;
      }
    }
  }

  return {
    leads_today: leadsToday || 0,
    leads_week: leadsWeek || 0,
    conversion_rate: rate,
    active_clients: activeCount,
    active_breakdown: breakdown || '-',
    pending_checkins: pendingCheckins,
    programs_week: programsWeek || 0,
    escalations: escalations || 0
  };
}

async function getLeads() {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return { leads: data || [] };
}

async function getClients() {
  const { data } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return { clients: data || [] };
}

async function getEscalations() {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('template_name', 'escalation_alert')
    .order('sent_at', { ascending: false })
    .limit(20);

  return { escalations: data || [] };
}
