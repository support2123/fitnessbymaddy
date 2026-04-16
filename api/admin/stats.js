// Admin dashboard data feed. Bearer-auth with ADMIN_TOKEN.

import { db } from '../../lib/supabase.js';
import { json, requireAdmin } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { error: 'unauthorized' });

  const sb = db();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    newLeadsToday, newLeadsWeek, convertedWeek, totalLeadsWeek,
    activeClients, pendingCheckinsRaw, programsWeek, escalationsOpen, programsFlagged
  ] = await Promise.all([
    countWhere(sb, 'leads', [['created_at','gte', dayAgo]]),
    countWhere(sb, 'leads', [['created_at','gte', weekAgo]]),
    countWhere(sb, 'leads', [['status','eq','converted'],['created_at','gte', weekAgo]]),
    countWhere(sb, 'leads', [['created_at','gte', weekAgo]]),
    groupByProgram(sb),
    pendingCheckins(sb, now),
    countWhere(sb, 'programs', [['generated_at','gte', weekAgo]]),
    countWhere(sb, 'escalations', [['resolved','eq', false]]),
    countWhere(sb, 'programs', [['flagged_for_review','eq', true],['generated_at','gte', weekAgo]])
  ]);

  const conv = totalLeadsWeek > 0 ? convertedWeek / totalLeadsWeek : 0;

  return json(res, 200, {
    ok: true,
    generated_at: new Date().toISOString(),
    leads: { today: newLeadsToday, this_week: newLeadsWeek },
    conversion_rate_7d: Number(conv.toFixed(3)),
    active_clients: activeClients,
    pending_checkins: pendingCheckinsRaw,
    programs_this_week: programsWeek,
    programs_flagged: programsFlagged,
    escalations_open: escalationsOpen
  });
}

async function countWhere(sb, table, filters) {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  for (const [col, op, val] of filters) q = q[op](col, val);
  const { count } = await q;
  return count || 0;
}

async function groupByProgram(sb) {
  const { data } = await sb.from('clients').select('program').eq('status','active');
  const by = {};
  (data || []).forEach(r => { by[r.program] = (by[r.program] || 0) + 1; });
  return by;
}

async function pendingCheckins(sb, nowMs) {
  const { data: clients } = await sb.from('clients')
    .select('id, program_started_at').eq('status','active');
  if (!clients) return 0;
  let pending = 0;
  for (const c of clients) {
    if (!c.program_started_at) continue;
    const week = Math.max(1, Math.ceil((nowMs - new Date(c.program_started_at).getTime()) / (7*24*60*60*1000)));
    const { data: row } = await sb.from('checkins')
      .select('form_submitted_at')
      .eq('client_id', c.id).eq('week_no', week).maybeSingle();
    if (!row?.form_submitted_at) pending++;
  }
  return pending;
}
