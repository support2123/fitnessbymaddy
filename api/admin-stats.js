import { supa } from './_lib/supabase.js';
import { json, requireAuth, requireMethod } from './_lib/http.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAuth(req, res, 'ADMIN_TOKEN')) return;

  const db = supa();
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setUTCDate(now.getUTCDate() - 7);

  try {
    const [
      leadsToday, leadsWeek, qualified, converted, activeClients,
      pendingCheckins, programsThisWeek, openEscalations
    ] = await Promise.all([
      countRows(db, 'leads', { gte: ['created_at', dayStart.toISOString()] }),
      countRows(db, 'leads', { gte: ['created_at', weekStart.toISOString()] }),
      countRows(db, 'leads', { eq: ['status', 'qualified'] }),
      countRows(db, 'leads', { eq: ['status', 'converted'] }),
      countRows(db, 'clients', { eq: ['status', 'active'] }),
      pendingCheckinsQuery(db, weekStart.toISOString()),
      countRows(db, 'programs', { gte: ['generated_at', weekStart.toISOString()] }),
      countRows(db, 'escalations', { eq: ['resolved', false] })
    ]);

    // Program mix
    const { data: byProgram } = await db.from('clients')
      .select('program')
      .eq('status', 'active');
    const programMix = (byProgram || []).reduce((acc, r) => {
      acc[r.program] = (acc[r.program] || 0) + 1; return acc;
    }, {});

    const convRate = leadsWeek > 0 ? (converted / leadsWeek) : 0;

    return json(res, 200, {
      leads_today: leadsToday,
      leads_week: leadsWeek,
      conversion_rate: Number(convRate.toFixed(3)),
      active_clients: activeClients,
      program_mix: programMix,
      pending_checkins: pendingCheckins,
      programs_this_week: programsThisWeek,
      open_escalations: openEscalations,
      generated_at: now.toISOString()
    });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

async function countRows(db, table, filters = {}) {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (filters.eq) q = q.eq(filters.eq[0], filters.eq[1]);
  if (filters.gte) q = q.gte(filters.gte[0], filters.gte[1]);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function pendingCheckinsQuery(db, weekStartIso) {
  // Rough: active clients minus clients who submitted a checkin this week.
  const { data: clients } = await db.from('clients').select('id').eq('status', 'active');
  if (!clients?.length) return 0;
  const ids = clients.map(c => c.id);
  const { data: submitted } = await db.from('checkins')
    .select('client_id').in('client_id', ids).gte('form_submitted_at', weekStartIso);
  const submittedSet = new Set((submitted || []).map(r => r.client_id));
  return ids.filter(id => !submittedSet.has(id)).length;
}
