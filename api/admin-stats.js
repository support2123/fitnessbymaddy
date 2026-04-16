// GET /api/admin-stats — read-only KPIs for the admin dashboard.
// Auth: Supabase access token in Authorization header. Email must be in
// ADMIN_ALLOWED_EMAILS.
import { db } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const email = await emailFromBearer(req);
  const allow = (process.env.ADMIN_ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!email || (allow.length && !allow.includes(email.toLowerCase()))) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const supa = db();
  const todayStart = startOfTodayIso();
  const weekStart = startOfWeekIso();

  const [
    leadsToday, leadsWeek, leadsTotal, converted,
    activeClients, programsThisWeek, openEscalations, pendingCheckins,
  ] = await Promise.all([
    countWhere(supa, 'leads', (q) => q.gte('created_at', todayStart)),
    countWhere(supa, 'leads', (q) => q.gte('created_at', weekStart)),
    countWhere(supa, 'leads'),
    countWhere(supa, 'leads', (q) => q.eq('status', 'converted')),
    listClientsByProgram(supa),
    countWhere(supa, 'programs', (q) => q.gte('generated_at', weekStart)),
    countWhere(supa, 'escalations', (q) => q.eq('resolved', false)),
    pendingCheckinCount(supa),
  ]);

  const conversionRate = leadsTotal > 0 ? +(converted / leadsTotal * 100).toFixed(1) : 0;

  return res.status(200).json({
    ok: true,
    leads_today: leadsToday,
    leads_this_week: leadsWeek,
    leads_total: leadsTotal,
    converted_total: converted,
    conversion_rate_pct: conversionRate,
    active_clients_by_program: activeClients,
    programs_generated_this_week: programsThisWeek,
    pending_checkins: pendingCheckins,
    open_escalations: openEscalations,
  });
}

async function emailFromBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || '',
        authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.email || null;
  } catch {
    return null;
  }
}

async function countWhere(supa, table, build = (q) => q) {
  let q = supa.from(table).select('id', { count: 'exact', head: true });
  q = build(q);
  const { count } = await q;
  return count || 0;
}

async function listClientsByProgram(supa) {
  const { data } = await supa.from('clients').select('program').eq('status', 'active');
  const tally = {};
  (data || []).forEach((c) => { tally[c.program] = (tally[c.program] || 0) + 1; });
  return tally;
}

async function pendingCheckinCount(supa) {
  const { data: clients } = await supa.from('clients')
    .select('id, program_started_at').eq('status', 'active');
  let pending = 0;
  for (const c of clients || []) {
    const weekNo = Math.floor((Date.now() - new Date(c.program_started_at).getTime()) / 86400_000 / 7);
    if (weekNo < 1) continue;
    const { data: ck } = await supa.from('checkins').select('id')
      .eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();
    if (!ck) pending++;
  }
  return pending;
}

function startOfTodayIso() {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}
function startOfWeekIso() {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString();
}
