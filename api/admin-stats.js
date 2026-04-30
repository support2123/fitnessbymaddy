const { getSupabase } = require('../lib/supabase');
const { corsHeaders, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return errorResponse(res, 'Method not allowed', 405);

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      clientsByProgram,
      pendingCheckins,
      programsThisWeek,
      recentEscalations,
      recentLeads,
      recentClients
    ] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('clients').select('program').eq('status', 'active'),
      db.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active'),
      db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      db.from('messages').select('*').eq('direction', 'out').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
      db.from('leads').select('id, name, phone, status, program_interest, created_at').order('created_at', { ascending: false }).limit(20),
      db.from('clients').select('id, name, phone, program, status, paid_amount, created_at').order('created_at', { ascending: false }).limit(20)
    ]);

    const programCounts = {};
    if (clientsByProgram.data) {
      for (const c of clientsByProgram.data) {
        programCounts[c.program] = (programCounts[c.program] || 0) + 1;
      }
    }

    // Calculate pending check-ins
    let pendingCount = 0;
    if (pendingCheckins.data) {
      for (const client of pendingCheckins.data) {
        const weekNo = calculateCurrentWeek(client.program_started_at);
        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();
        if (!checkin) pendingCount++;
      }
    }

    const totalLeadsCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalLeadsCount > 0
      ? ((convertedCount / totalLeadsCount) * 100).toFixed(1)
      : '0.0';

    return jsonResponse(res, {
      leads_today: leadsToday.count || 0,
      leads_this_week: leadsWeek.count || 0,
      total_leads: totalLeadsCount,
      conversion_rate: parseFloat(conversionRate),
      active_clients: activeClients.count || 0,
      clients_by_program: programCounts,
      pending_checkins: pendingCount,
      programs_this_week: programsThisWeek.count || 0,
      escalations: (recentEscalations.data || []).map(function(e) {
        return { body: e.body, sent_at: e.sent_at };
      }),
      recent_leads: (recentLeads.data || []).map(function(l) {
        return {
          id: l.id,
          name: l.name,
          phone: maskForAdmin(l.phone),
          status: l.status,
          interest: l.program_interest,
          created_at: l.created_at
        };
      }),
      recent_clients: (recentClients.data || []).map(function(c) {
        return {
          id: c.id,
          name: c.name,
          phone: maskForAdmin(c.phone),
          program: c.program,
          status: c.status,
          paid: c.paid_amount ? (c.paid_amount / 100) : 0,
          created_at: c.created_at
        };
      })
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function calculateCurrentWeek(startDate) {
  var start = new Date(startDate);
  var now = new Date();
  return Math.max(1, Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000)));
}

function maskForAdmin(phone) {
  if (!phone) return '—';
  return phone.slice(0, 6) + '***' + phone.slice(-2);
}
