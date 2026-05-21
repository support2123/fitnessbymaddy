const { getClient } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, {});
  if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return jsonResponse(res, 401, { error: 'Unauthorized' });

  try {
    const db = getClient();
    const { data: userData, error: authError } = await db.auth.getUser(token);
    if (authError || !userData.user) {
      return jsonResponse(res, 401, { error: 'Invalid token' });
    }

    const section = req.query.section || 'stats';

    if (section === 'stats') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [leadsToday, leadsWeek, totalLeads, convertedLeads, activeClientsResult, recentCheckins, programsWeek] = await Promise.all([
        db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
        db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
        db.from('leads').select('id', { count: 'exact', head: true }),
        db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
        db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        db.from('checkins').select('client_id').gte('form_submitted_at', weekStart),
        db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart)
      ]);

      const total = totalLeads.count || 0;
      const converted = convertedLeads.count || 0;
      const rate = total > 0 ? Math.round((converted / total) * 100) : 0;
      const activeCount = activeClientsResult.count || 0;
      const checkedInIds = new Set((recentCheckins.data || []).map(c => c.client_id));
      const pending = Math.max(0, activeCount - checkedInIds.size);

      return jsonResponse(res, 200, {
        leads_today: leadsToday.count || 0,
        leads_week: leadsWeek.count || 0,
        conversion_rate: rate,
        active_clients: activeCount,
        pending_checkins: pending,
        programs_week: programsWeek.count || 0
      });
    }

    if (section === 'leads') {
      const { data } = await db.from('leads')
        .select('id, phone, name, status, program_interest, market, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      return jsonResponse(res, 200, data || []);
    }

    if (section === 'clients') {
      const { data } = await db.from('clients')
        .select('id, name, phone, program, status, program_started_at, program_ends_at, paid_amount')
        .order('created_at', { ascending: false })
        .limit(100);
      return jsonResponse(res, 200, data || []);
    }

    if (section === 'checkins') {
      const { data } = await db.from('checkins')
        .select('id, week_no, weight, compliance_score, energy, issues, form_submitted_at, clients(name)')
        .order('form_submitted_at', { ascending: false })
        .limit(50);
      return jsonResponse(res, 200, data || []);
    }

    if (section === 'escalations') {
      const { data } = await db.from('messages')
        .select('id, phone, body, sent_at')
        .eq('direction', 'out')
        .like('body', '%ESCALATION%')
        .order('sent_at', { ascending: false })
        .limit(30);
      return jsonResponse(res, 200, data || []);
    }

    return jsonResponse(res, 400, { error: 'Unknown section' });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
