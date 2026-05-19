import { createClient } from '../../lib/supabase.js';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'medication', 'pain',
  'dizziness', 'not eating', 'eating disorder', 'throwing up',
];

/**
 * Returns the start of today (UTC) as ISO string.
 */
function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Returns the start of this week (Monday, UTC) as ISO string.
 */
function startOfWeek() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Returns the start of this month (UTC) as ISO string.
 */
function startOfMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Compute the current week number for a client based on their program start date.
 */
function computeWeekNumber(programStartedAt) {
  if (!programStartedAt) return null;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return weeks > 0 ? weeks : 1;
}

/**
 * Check if a message body contains escalation keywords.
 */
function isEscalation(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Mask phone number for privacy: "+91XXX...374"
 */
function maskPhone(phone) {
  if (!phone) return '***';
  const p = String(phone).replace(/\s+/g, '');
  const match = p.match(/^(\+\d{1,3})/);
  const last3 = p.slice(-3);
  return match ? `${match[1]}XXX...${last3}` : `XXX...${last3}`;
}

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Gym',
  '6wk_home': '6-Week Home',
  '12wk': '12-Week Transform',
  pcos: 'PCOS Program',
  '40plus': '40+ Program',
  zoom_trial: 'Zoom Trial',
  zoom_pack: 'Zoom Pack',
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---- Auth check ----
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error('admin/stats: INTERNAL_API_SECRET not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    return res.status(403).json({ error: 'Invalid authorization token' });
  }

  // ---- Query data ----
  try {
    const supabase = createClient();

    const todayStart = startOfToday();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    // Run all independent queries in parallel
    const [
      leadsTodayRes,
      leadsWeekRes,
      leadsMonthRes,
      clientsMonthRes,
      activeClientsRes,
      programsWeekRes,
      recentLeadsRes,
      messagesRes,
    ] = await Promise.all([
      // leads_today
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart),

      // leads_this_week
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekStart),

      // leads this month (for conversion rate denominator)
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart),

      // clients created this month (for conversion rate numerator)
      supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart),

      // active clients with program info
      supabase
        .from('clients')
        .select('id, name, phone, program, program_started_at, status, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false }),

      // programs_generated_week
      supabase
        .from('programs')
        .select('id', { count: 'exact', head: true })
        .gte('generated_at', weekStart),

      // recent_leads (last 20)
      supabase
        .from('leads')
        .select('id, name, phone, status, program_interest, market, created_at')
        .order('created_at', { ascending: false })
        .limit(20),

      // messages this week for escalation detection
      supabase
        .from('messages')
        .select('id, phone, body, sent_at, status')
        .eq('direction', 'in')
        .gte('sent_at', weekStart)
        .order('sent_at', { ascending: false }),
    ]);

    // ---- Compute derived stats ----

    const leadsToday = leadsTodayRes.count || 0;
    const leadsThisWeek = leadsWeekRes.count || 0;
    const leadsMonthCount = leadsMonthRes.count || 0;
    const clientsMonthCount = clientsMonthRes.count || 0;
    const conversionRate =
      leadsMonthCount > 0
        ? parseFloat(((clientsMonthCount / leadsMonthCount) * 100).toFixed(1))
        : 0;
    const programsGeneratedWeek = programsWeekRes.count || 0;

    // Active clients grouped by program
    const activeClientsList = activeClientsRes.data || [];
    const activeClientsByProgram = {};
    let totalActive = 0;
    for (const client of activeClientsList) {
      const prog = client.program || 'unknown';
      activeClientsByProgram[prog] = (activeClientsByProgram[prog] || 0) + 1;
      totalActive++;
    }

    // Format active_clients breakdown with labels
    const activeClientsBreakdown = {};
    for (const [key, count] of Object.entries(activeClientsByProgram)) {
      activeClientsBreakdown[key] = {
        label: PROGRAM_LABELS[key] || key,
        count,
      };
    }

    // Pending check-ins: active clients without a check-in this week
    let pendingCheckins = 0;
    if (activeClientsList.length > 0) {
      const clientIds = activeClientsList.map((c) => c.id);
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('client_id')
        .in('client_id', clientIds)
        .gte('form_submitted_at', weekStart);

      const checkedInIds = new Set();
      if (recentCheckins) {
        for (const ci of recentCheckins) {
          checkedInIds.add(ci.client_id);
        }
      }
      pendingCheckins = clientIds.filter((id) => !checkedInIds.has(id)).length;
    }

    // Escalations: inbound messages with escalation keywords, not yet acknowledged
    const allMessages = messagesRes.data || [];
    const escalationMessages = allMessages.filter(
      (m) =>
        isEscalation(m.body) &&
        m.status !== 'acknowledged' &&
        m.status !== 'dismissed'
    );
    const escalationsCount = escalationMessages.length;

    // Mask phone numbers in recent leads
    const recentLeads = (recentLeadsRes.data || []).map((lead) => ({
      ...lead,
      phone_masked: maskPhone(lead.phone),
      phone: undefined, // strip raw phone
    }));

    // Build active clients list with week numbers and last check-in
    let activeClientsListFormatted = [];
    if (activeClientsList.length > 0) {
      const clientIds = activeClientsList.map((c) => c.id);
      const { data: allCheckins } = await supabase
        .from('checkins')
        .select('client_id, form_submitted_at, week_no')
        .in('client_id', clientIds)
        .order('form_submitted_at', { ascending: false });

      // Latest check-in per client
      const latestCheckin = {};
      if (allCheckins) {
        for (const ci of allCheckins) {
          if (!latestCheckin[ci.client_id]) {
            latestCheckin[ci.client_id] = ci;
          }
        }
      }

      activeClientsListFormatted = activeClientsList.map((client) => {
        const lastCi = latestCheckin[client.id];
        return {
          id: client.id,
          name: client.name,
          phone_masked: maskPhone(client.phone),
          program: client.program,
          program_label: PROGRAM_LABELS[client.program] || client.program,
          week_number: computeWeekNumber(client.program_started_at),
          last_checkin_date: lastCi ? lastCi.form_submitted_at : null,
          last_checkin_week: lastCi ? lastCi.week_no : null,
          status: client.status,
        };
      });
    }

    // Format escalations for response (mask phones)
    const escalationsFormatted = escalationMessages.map((m) => ({
      id: m.id,
      phone_masked: maskPhone(m.phone),
      message_preview:
        m.body && m.body.length > 200 ? m.body.substring(0, 200) + '...' : m.body,
      sent_at: m.sent_at,
      status: m.status,
    }));

    // ---- Respond ----
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      stats: {
        leads_today: leadsToday,
        leads_this_week: leadsThisWeek,
        conversion_rate: conversionRate,
        conversion_detail: {
          clients_this_month: clientsMonthCount,
          leads_this_month: leadsMonthCount,
        },
        active_clients: {
          total: totalActive,
          by_program: activeClientsBreakdown,
        },
        pending_checkins: pendingCheckins,
        programs_generated_week: programsGeneratedWeek,
        escalations: escalationsCount,
      },
      recent_leads: recentLeads,
      active_clients_list: activeClientsListFormatted,
      escalations_list: escalationsFormatted,
    });
  } catch (err) {
    console.error('admin/stats: unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
