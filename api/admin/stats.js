// Dashboard metrics. Reads with service role; the dashboard page is
// auth-gated at the browser via Supabase Auth + an ADMIN_EMAILS allowlist.

import { db } from '../../lib/supabase.js';
import { json, methodNotAllowed } from '../../lib/http.js';

const DAY = 86400000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  // Validate bearer token is a Supabase user in the allowlist
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { ok: false, error: 'no_token' });
  const { data: user, error: uErr } = await db().auth.getUser(token);
  if (uErr || !user?.user?.email) return json(res, 401, { ok: false, error: 'bad_token' });
  const allow = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(user.user.email.toLowerCase())) {
    return json(res, 403, { ok: false, error: 'not_admin' });
  }

  const now = Date.now();
  const todayIso = new Date(now - DAY).toISOString();
  const weekIso  = new Date(now - 7 * DAY).toISOString();

  const [newToday, newWeek, leadsWeek, convertedWeek, active, activeByProg, pendingCheckins, programsWeek, openEsc] =
    await Promise.all([
      db().from('leads').select('id', { count: 'exact', head: true }).gt('created_at', todayIso),
      db().from('leads').select('id', { count: 'exact', head: true }).gt('created_at', weekIso),
      db().from('leads').select('id', { count: 'exact', head: true }).gt('created_at', weekIso),
      db().from('clients').select('id', { count: 'exact', head: true }).gt('created_at', weekIso),
      db().from('clients').select('id, program').eq('status', 'active'),
      db().from('clients').select('program').eq('status', 'active'),
      db().from('checkins').select('id', { count: 'exact', head: true }).is('form_submitted_at', null),
      db().from('programs').select('id', { count: 'exact', head: true }).gt('generated_at', weekIso),
      db().from('escalations').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(25)
    ]);

  const programCounts = {};
  for (const r of (activeByProg.data || [])) programCounts[r.program] = (programCounts[r.program] || 0) + 1;

  const convRate = (leadsWeek.count || 0) > 0
    ? Math.round(((convertedWeek.count || 0) / leadsWeek.count) * 1000) / 10
    : 0;

  return json(res, 200, {
    ok: true,
    new_leads_today: newToday.count || 0,
    new_leads_week:  newWeek.count  || 0,
    conversion_rate_week_pct: convRate,
    active_clients: active.data?.length || 0,
    active_by_program: programCounts,
    pending_checkins: pendingCheckins.count || 0,
    programs_generated_week: programsWeek.count || 0,
    open_escalations: openEsc.data || []
  });
}
