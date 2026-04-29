const { createClient } = require('@supabase/supabase-js');

let _client;

function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    _client = createClient(url, key);
  }
  return _client;
}

async function insertLead(lead) {
  const { data, error } = await getClient()
    .from('leads')
    .insert(lead)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getLeadByPhone(phone) {
  const { data } = await getClient()
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

async function updateLead(id, updates) {
  const { data, error } = await getClient()
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function insertClient(client) {
  const { data, error } = await getClient()
    .from('clients')
    .insert(client)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getClientById(id) {
  const { data } = await getClient()
    .from('clients')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

async function getActiveClients() {
  const { data, error } = await getClient()
    .from('clients')
    .select('*')
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

async function insertCheckin(checkin) {
  const { data, error } = await getClient()
    .from('checkins')
    .insert(checkin)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRecentCheckins(clientId, limit = 2) {
  const { data } = await getClient()
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(limit);
  return data || [];
}

async function insertProgram(program) {
  const { data, error } = await getClient()
    .from('programs')
    .insert(program)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function logMessage(msg) {
  const { error } = await getClient()
    .from('messages')
    .insert(msg);
  if (error) console.error('Failed to log message:', error.message);
}

async function getLeadsPendingNudge(cutoffHours, status) {
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();
  const { data } = await getClient()
    .from('leads')
    .select('*')
    .eq('status', status)
    .lt('last_msg_at', cutoff);
  return data || [];
}

async function getDroppedLeadsForReEngagement() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await getClient()
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', sevenDaysAgo);
  return data || [];
}

async function getClientsMissingCheckin(weekNo) {
  const { data } = await getClient()
    .from('clients')
    .select('*, checkins!left(id, week_no)')
    .eq('status', 'active')
    .not('checkins.week_no', 'eq', weekNo);
  return data || [];
}

async function getDashboardStats() {
  const db = getClient();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

  const [leadsToday, leadsWeek, allLeads, activeClients, pendingCheckins, programsWeek, escalations] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    db.from('leads').select('id, status', { count: 'exact' }),
    db.from('clients').select('id, program', { count: 'exact' }).eq('status', 'active'),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
    db.from('messages').select('id, body', { count: 'exact', head: true })
      .eq('direction', 'in')
      .or('body.ilike.%refund%,body.ilike.%pain%,body.ilike.%injury%,body.ilike.%complaint%')
      .gte('sent_at', weekStart),
  ]);

  const convertedCount = allLeads.data ? allLeads.data.filter(l => l.status === 'converted').length : 0;
  const totalLeads = allLeads.count || 0;

  const programBreakdown = {};
  if (activeClients.data) {
    activeClients.data.forEach(c => {
      programBreakdown[c.program] = (programBreakdown[c.program] || 0) + 1;
    });
  }

  return {
    leads_today: leadsToday.count || 0,
    leads_this_week: leadsWeek.count || 0,
    conversion_rate: totalLeads > 0 ? ((convertedCount / totalLeads) * 100).toFixed(1) : '0.0',
    active_clients: activeClients.count || 0,
    active_by_program: programBreakdown,
    pending_checkins: pendingCheckins.count || 0,
    programs_generated_week: programsWeek.count || 0,
    escalations_week: escalations.count || 0,
  };
}

module.exports = {
  getClient,
  insertLead,
  getLeadByPhone,
  updateLead,
  insertClient,
  getClientById,
  getActiveClients,
  insertCheckin,
  getRecentCheckins,
  insertProgram,
  logMessage,
  getLeadsPendingNudge,
  getDroppedLeadsForReEngagement,
  getClientsMissingCheckin,
  getDashboardStats,
};
