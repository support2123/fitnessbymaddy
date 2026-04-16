// Admin dashboard JSON feed. Auth = Supabase JWT (Bearer token) whose email is in
// ADMIN_ALLOWED_EMAILS (comma-separated).

const { admin } = require('../_lib/supabase');
const { ok, err, assertMethod } = require('../_lib/utils');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['GET'])) return;

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return err(res, 401, 'missing_token');

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return err(res, 500, 'supabase_env_missing');

  const authClient = createClient(url, anon);
  const { data: userRes, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userRes?.user) return err(res, 401, 'invalid_token');

  const allowed = (process.env.ADMIN_ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(userRes.user.email?.toLowerCase())) {
    return err(res, 403, 'not_allowed');
  }

  const sb = admin();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();

  const [{ count: newToday }, { count: newWeek }, leadWeekRes, clientsRes, pendingRes, progWeekRes, escRes] = await Promise.all([
    sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', startOfDay),
    sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('leads').select('id,status', { head: false }).gte('created_at', weekAgo),
    sb.from('clients').select('id,program,status').eq('status', 'active'),
    sb.from('checkins').select('client_id,week_no,created_at,form_submitted_at').is('form_submitted_at', null),
    sb.from('programs').select('id,generated_at,flagged_for_review').gte('generated_at', weekAgo),
    sb.from('escalations').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(20),
  ]);

  const leadsWeek = leadWeekRes.data || [];
  const converted = leadsWeek.filter((l) => l.status === 'converted').length;
  const conversionRate = leadsWeek.length ? Math.round((converted / leadsWeek.length) * 100) : 0;

  const byProgram = {};
  for (const c of clientsRes.data || []) byProgram[c.program] = (byProgram[c.program] || 0) + 1;

  return ok(res, {
    new_leads_today: newToday || 0,
    new_leads_week: newWeek || 0,
    conversion_rate_week: conversionRate,
    active_clients: (clientsRes.data || []).length,
    active_by_program: byProgram,
    pending_checkins: (pendingRes.data || []).length,
    programs_week: (progWeekRes.data || []).length,
    flagged_week: (progWeekRes.data || []).filter((p) => p.flagged_for_review).length,
    escalations_open: escRes.data || [],
  });
};
