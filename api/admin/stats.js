import { getSupabase } from '../_lib/supabase.js';
import { handleCors } from '../_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    leadsToday,
    leadsWeek,
    leadsConverted,
    leadsTotal,
    activeClients,
    programsWeek,
    recentLeads,
    allActiveClients,
    recentEscalations
  ] = await Promise.all([
    db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
    db.from('leads').select('*', { count: 'exact', head: true }),
    db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('leads').select('id,phone,market,program_interest,status,created_at').order('created_at', { ascending: false }).limit(15),
    db.from('clients').select('id,name,phone,program,program_started_at,status').eq('status', 'active'),
    db.from('messages').select('id,phone,body,sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10)
  ]);

  const totalLeads = leadsTotal.count || 1;
  const convertedCount = leadsConverted.count || 0;

  const clientsByProgram = {};
  (allActiveClients.data || []).forEach(c => {
    clientsByProgram[c.program] = (clientsByProgram[c.program] || 0) + 1;
  });

  const pendingCheckins = [];
  for (const c of (allActiveClients.data || [])) {
    const start = new Date(c.program_started_at);
    const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const week = Math.ceil(days / 7);
    if (week < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', c.id)
      .eq('week_no', week)
      .limit(1);

    if (!existing || existing.length === 0) {
      pendingCheckins.push({
        client_name: c.name || maskPhone(c.phone),
        program: c.program,
        week_no: week
      });
    }
  }

  return res.json({
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: Math.round((convertedCount / totalLeads) * 100),
    active_clients: activeClients.count || 0,
    programs_this_week: programsWeek.count || 0,
    pending_checkins: pendingCheckins.length,
    recent_leads: (recentLeads.data || []).map(l => ({
      ...l,
      phone: maskPhone(l.phone)
    })),
    clients_by_program: clientsByProgram,
    pending_checkin_list: pendingCheckins.slice(0, 15),
    escalations: (recentEscalations.data || []).map(e => ({
      ...e,
      phone: maskPhone(e.phone)
    }))
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}
