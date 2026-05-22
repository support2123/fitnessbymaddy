const { getSupabase } = require('./lib/supabase');

function authorize(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  return token === process.env.ADMIN_KEY;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!authorize(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathParts = url.pathname.replace('/api/admin', '').split('/').filter(Boolean);
  const action = pathParts[0] || 'stats';

  try {
    if (action === 'stats') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: leadsToday },
        { count: leadsWeek },
        { count: totalLeads },
        { count: convertedLeads },
        { count: activeClients },
        { count: programsWeek }
      ] = await Promise.all([
        db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
        db.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
        db.from('leads').select('*', { count: 'exact', head: true }),
        db.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
        db.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        db.from('programs').select('*', { count: 'exact', head: true }).gte('generated_at', weekStart)
      ]);

      const conversionRate = totalLeads > 0
        ? Math.round((convertedLeads / totalLeads) * 100)
        : 0;

      const { count: pendingCheckins } = await db
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      return res.status(200).json({
        leadsToday: leadsToday || 0,
        leadsWeek: leadsWeek || 0,
        conversionRate,
        activeClients: activeClients || 0,
        pendingCheckins: pendingCheckins || 0,
        programsWeek: programsWeek || 0
      });
    }

    if (action === 'escalations') {
      if (pathParts.length > 1 && pathParts[2] === 'resolve' && req.method === 'POST') {
        const escalationId = pathParts[1];
        await db.from('escalations')
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq('id', escalationId);
        return res.status(200).json({ success: true });
      }

      const { data } = await db
        .from('escalations')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(50);

      return res.status(200).json({ escalations: data || [] });
    }

    if (action === 'leads') {
      const { data } = await db
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.status(200).json({ leads: data || [] });
    }

    if (action === 'clients') {
      const { data } = await db
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.status(200).json({ clients: data || [] });
    }

    if (action === 'checkins') {
      const { data } = await db
        .from('checkins')
        .select('*, clients(name)')
        .order('form_submitted_at', { ascending: false })
        .limit(50);

      return res.status(200).json({ checkins: data || [] });
    }

    return res.status(404).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Admin API error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
