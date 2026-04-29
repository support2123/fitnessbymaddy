const { getSupabase } = require('../../lib/supabase');
const { sendJson, sendError, corsHeaders } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return sendError(res, 405, 'GET only');

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return sendError(res, 401, 'Unauthorized');
  }

  const db = getSupabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [leadsRes, clientsRes, escalationsRes, programsRes] = await Promise.all([
    db.from('leads').select('id, status, created_at').order('created_at', { ascending: false }),
    db.from('clients').select('id, program, status, program_started_at'),
    db.from('escalations').select('id').eq('resolved', false),
    db.from('programs').select('id').gte('generated_at', weekStart),
  ]);

  const leads = leadsRes.data || [];
  const clients = clientsRes.data || [];

  return sendJson(res, 200, {
    leads_today: leads.filter(l => l.created_at >= todayStart).length,
    leads_this_week: leads.filter(l => l.created_at >= weekStart).length,
    total_leads: leads.length,
    converted: leads.filter(l => l.status === 'converted').length,
    active_clients: clients.filter(c => c.status === 'active').length,
    open_escalations: (escalationsRes.data || []).length,
    programs_this_week: (programsRes.data || []).length,
  });
};
