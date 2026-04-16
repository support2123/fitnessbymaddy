// JSON data feed for the admin dashboard. Auth via Supabase bearer
// token (Authorization: Bearer <access_token>). The token is verified
// against Supabase Auth and the resolved email must be in
// ADMIN_ALLOWED_EMAILS.

import { supa } from '../lib/supabase.js';
import { jsonResponse } from '../lib/utils.js';

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(res, 401, { error: 'unauthorised' });

  const { data: user, error } = await supa().auth.getUser(token);
  if (error || !user?.user?.email) return jsonResponse(res, 401, { error: 'invalid_token' });

  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.user.email.toLowerCase())) {
    return jsonResponse(res, 403, { error: 'not_allowed' });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [leadsToday, leadsWeek, leadsAll, clients, escalated, pendingCheckins, programsWeek] =
    await Promise.all([
      supa().from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      supa().from('leads').select('id', { count: 'exact', head: true }).gte('created_at', since),
      supa().from('leads').select('status'),
      supa().from('clients').select('id, program, status'),
      supa().from('leads').select('id, phone, escalation_reason, created_at').eq('escalated', true).limit(50),
      supa().from('clients').select('id, phone, name, program, program_started_at').eq('status', 'active'),
      supa().from('programs').select('id').gte('generated_at', since)
    ]);

  // Conversion rate (lead → paid) this week.
  const total = leadsWeek.count || 0;
  const { count: converted } = await supa().from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since).eq('status', 'converted');
  const conversionRate = total ? Math.round((converted / total) * 100) : 0;

  const activeByProgram = {};
  for (const c of clients.data || []) {
    if (c.status === 'active') activeByProgram[c.program] = (activeByProgram[c.program] || 0) + 1;
  }

  // Pending check-ins: active clients whose current week has no check-in row yet.
  const pending = [];
  for (const c of pendingCheckins.data || []) {
    const weekNo = weekSince(c.program_started_at);
    const { data: row } = await supa().from('checkins')
      .select('id').eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();
    if (!row) pending.push({ client_id: c.id, phone: c.phone, name: c.name, week_no: weekNo });
  }

  return jsonResponse(res, 200, {
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate_pct: conversionRate,
    active_by_program: activeByProgram,
    pending_checkins: pending,
    programs_generated_week: (programsWeek.data || []).length,
    escalations: escalated.data || []
  });
}

function weekSince(iso) {
  if (!iso) return 1;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(1, Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1);
}
