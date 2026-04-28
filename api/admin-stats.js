const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token || token === 'null') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: user, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday, leadsWeek, totalLeads, convertedLeads,
      activeClients, recentLeadsData, programsWeek,
      flaggedPrograms, missedCheckins,
    ] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
      db.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('programs').select('client_id, week_no, notes').ilike('notes', 'FLAGGED%').limit(10),
      db.from('clients')
        .select('id, name, phone, program_started_at')
        .eq('status', 'active')
        .not('program_started_at', 'is', null),
    ]);

    const programsBreakdown = {};
    if (activeClients.data) {
      for (const c of activeClients.data) {
        const p = c.program || 'unknown';
        programsBreakdown[p] = (programsBreakdown[p] || 0) + 1;
      }
    }

    let pendingCheckins = 0;
    if (missedCheckins.data) {
      for (const client of missedCheckins.data) {
        const start = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
        if (weekNo >= 1) {
          const { data: ci } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();
          if (!ci) pendingCheckins++;
        }
      }
    }

    const escalations = [];
    if (flaggedPrograms.data) {
      for (const p of flaggedPrograms.data) {
        const { data: client } = await db.from('clients').select('name, phone').eq('id', p.client_id).single();
        escalations.push({
          type: 'Flagged Program',
          client: client ? `${client.name} (${maskPhone(client.phone)})` : 'Unknown',
          details: `Week ${p.week_no} — ${(p.notes || '').slice(0, 100)}`,
          date: now.toISOString(),
        });
      }
    }

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      total_leads: totalLeads.count || 0,
      converted_leads: convertedLeads.count || 0,
      active_clients: activeClients.count || 0,
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      programs_breakdown: programsBreakdown,
      recent_leads: recentLeadsData.data || [],
      escalations,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
