import supabase from './_lib/supabase.js';
import { jsonResponse } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
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
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('clients').select('program, status').eq('status', 'active'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('messages').select('phone, body, sent_at')
        .eq('template_name', 'escalation_alert')
        .order('sent_at', { ascending: false }).limit(10),
      supabase.from('leads').select('id, phone, name, status, program_interest, market, created_at')
        .order('created_at', { ascending: false }).limit(20),
    ]);

    const convertedCount = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'converted');

    const totalLeads = allLeads.count || 0;
    const converted = convertedCount.count || 0;
    const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    const programBreakdown = {};
    if (clientsByProgram.data) {
      clientsByProgram.data.forEach(c => {
        programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
      });
    }

    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const startDate = new Date(client.program_started_at);
        const currentWeek = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (!checkin) pendingCount++;
      }
    }

    return jsonResponse(res, 200, {
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeads,
      conversion_rate: conversionRate,
      active_clients: activeClients.count || 0,
      programs_by_type: programBreakdown,
      pending_checkins: pendingCount,
      programs_generated_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(e => ({
        phone: e.phone ? e.phone.slice(0, 4) + 'XXX...' + e.phone.slice(-3) : '***',
        body: e.body,
        sent_at: e.sent_at,
      })),
      recent_leads: (recentLeads.data || []).map(l => ({
        id: l.id,
        name: l.name,
        phone: l.phone ? l.phone.slice(0, 4) + 'XXX...' + l.phone.slice(-3) : '***',
        status: l.status,
        program_interest: l.program_interest,
        market: l.market,
        created_at: l.created_at,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
