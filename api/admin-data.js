const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsToday,
      leadsWeek,
      totalLeads,
      convertedLeads,
      activeClients,
      pendingCheckins,
      programsWeek,
      recentLeads,
      escalations,
    ] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      supabase.from('clients').select('*').eq('status', 'active').order('program_started_at', { ascending: false }),
      countPendingCheckins(now),
      supabase.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('*').eq('direction', 'out').eq('phone', process.env.MADDY_PHONE || '917082478374').ilike('body', '%ESCALATION%').order('sent_at', { ascending: false }).limit(10),
    ]);

    const totalCount = totalLeads.count || 0;
    const convertedCount = convertedLeads.count || 0;
    const conversionRate = totalCount > 0 ? Math.round((convertedCount / totalCount) * 100) : 0;

    return res.status(200).json({
      leads_today: leadsToday.count || 0,
      leads_week: leadsWeek.count || 0,
      conversion_rate: conversionRate,
      active_clients_count: activeClients.data?.length || 0,
      active_clients: activeClients.data || [],
      pending_checkins: pendingCheckins,
      programs_week: programsWeek.count || 0,
      recent_leads: recentLeads.data || [],
      escalations: escalations.data || [],
    });
  } catch (err) {
    console.error('admin-data error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function verifyToken(tokenB64) {
  try {
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminPass || !tokenB64) return false;
    const decoded = Buffer.from(tokenB64, 'base64').toString();
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const [token, expiry, hmac] = parts;
    if (Date.now() > parseInt(expiry, 10)) return false;
    const expected = crypto.createHmac('sha256', adminPass).update(`${token}:${expiry}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function countPendingCheckins(now) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, program_started_at')
    .eq('status', 'active');

  if (!clients || clients.length === 0) return 0;

  let pending = 0;
  for (const c of clients) {
    const start = new Date(c.program_started_at);
    const weekNo = Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
    if (weekNo < 1) continue;
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', c.id)
      .eq('week_no', weekNo)
      .maybeSingle();
    if (!data) pending++;
  }
  return pending;
}
