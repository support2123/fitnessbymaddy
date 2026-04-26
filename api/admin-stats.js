const { supabase } = require('./_lib/supabase');
const { json } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return json(res, 401, { error: 'Invalid session' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: leadsToday },
      { count: leadsThisWeek },
      { count: totalLeads },
      { count: convertedLeads },
      { data: clientsByProgram },
      { data: activeClients },
      { data: pendingCheckins },
      { data: programsThisWeek },
      { data: recentEscalations },
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('program, status'),
      supabase.from('clients').select('id, name, phone, program, program_started_at').eq('status', 'active').order('program_started_at', { ascending: false }).limit(20),
      supabase.from('clients').select('id, name, phone, program').eq('status', 'active'),
      supabase.from('programs').select('id, client_id, week_no, generated_at').gte('generated_at', weekStart).order('generated_at', { ascending: false }),
      supabase.from('messages').select('phone, body, sent_at').eq('template_name', 'escalation_alert').order('sent_at', { ascending: false }).limit(10),
    ]);

    const programCounts = {};
    if (clientsByProgram) {
      clientsByProgram.forEach(function(c) {
        if (c.status === 'active') {
          programCounts[c.program] = (programCounts[c.program] || 0) + 1;
        }
      });
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1)
      : '0.0';

    return json(res, 200, {
      leads: {
        today: leadsToday || 0,
        this_week: leadsThisWeek || 0,
        total: totalLeads || 0,
        converted: convertedLeads || 0,
        conversion_rate: conversionRate,
      },
      clients: {
        by_program: programCounts,
        active_list: (activeClients || []).map(function(c) {
          return { id: c.id, name: c.name, program: c.program, started: c.program_started_at };
        }),
      },
      pending_checkins: (pendingCheckins || []).length,
      programs_generated_this_week: (programsThisWeek || []).length,
      escalations: (recentEscalations || []).map(function(e) {
        return { body: e.body, sent_at: e.sent_at };
      }),
    });
  } catch (err) {
    console.error('admin-stats error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
