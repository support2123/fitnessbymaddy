const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const parts = token.split('.');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid token' });

  const expected = crypto
    .createHmac('sha256', process.env.INTERNAL_API_KEY || 'fbm-secret')
    .update(parts[0])
    .digest('hex');

  if (parts[1] !== expected) return res.status(401).json({ error: 'Invalid token' });

  try {
    const query = req.query.q;

    switch (query) {
      case 'stats':
        return res.json(await getStats());
      case 'leads':
        return res.json(await getLeads());
      case 'clients':
        return res.json(await getClients());
      case 'checkins':
        return res.json(await getCheckins());
      case 'recent':
        return res.json(await getRecentMessages());
      case 'escalations':
        return res.json(await getEscalations());
      default:
        return res.status(400).json({ error: 'Unknown query' });
    }
  } catch (err) {
    console.error('[ADMIN-DATA ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

  const [leadsToday, leadsWeek, totalLeads, convertedLeads, activeClients, pendingCheckins, programsWeek] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('programs').select('id', { count: 'exact', head: true }).gte('generated_at', weekStart),
  ]);

  const total = totalLeads.count || 0;
  const converted = convertedLeads.count || 0;
  const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

  return {
    leads_today: leadsToday.count || 0,
    leads_week: leadsWeek.count || 0,
    conversion_rate: rate,
    active_clients: activeClients.count || 0,
    pending_checkins: pendingCheckins.count || 0,
    programs_week: programsWeek.count || 0,
  };
}

async function getLeads() {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  return { leads: data || [] };
}

async function getClients() {
  const { data } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  return { clients: data || [] };
}

async function getCheckins() {
  const { data } = await supabase
    .from('checkins')
    .select('*')
    .order('form_submitted_at', { ascending: false })
    .limit(50);
  return { checkins: data || [] };
}

async function getRecentMessages() {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(50);
  return { messages: data || [] };
}

async function getEscalations() {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'out')
    .like('template_name', '%escalation%')
    .order('sent_at', { ascending: false })
    .limit(20);
  return { escalations: data || [] };
}
