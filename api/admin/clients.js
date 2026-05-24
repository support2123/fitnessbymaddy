const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    const [
      { data: clients },
      { data: leads },
      { data: allClients }
    ] = await Promise.all([
      db.from('clients')
        .select('*')
        .eq('status', 'active')
        .order('program_started_at', { ascending: false })
        .limit(50),
      db.from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      db.from('clients')
        .select('id, name, phone, program, program_started_at, status')
        .limit(200)
    ]);

    const clientsWithWeek = (clients || []).map(c => {
      const startDate = new Date(c.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      return { ...c, current_week: Math.max(1, Math.ceil(daysSinceStart / 7)) };
    });

    const pendingCheckins = [];
    for (const c of clientsWithWeek) {
      const weekNo = c.current_week;
      const { data: existing } = await db.from('checkins')
        .select('id')
        .eq('client_id', c.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!existing || existing.length === 0) {
        const dayOfWeek = now.getDay();
        pendingCheckins.push({
          name: c.name,
          client_id: c.id,
          week_no: weekNo,
          days_overdue: dayOfWeek
        });
      }
    }

    if (req.query && req.query.format === 'csv') {
      const rows = (allClients || []).map(c =>
        [c.name, c.phone, c.program, c.status, c.program_started_at].join(',')
      );
      const csv = 'Name,Phone,Program,Status,Started\n' + rows.join('\n');
      return res.status(200).json({ csv });
    }

    return res.status(200).json({
      clients: clientsWithWeek,
      leads: leads || [],
      pending_checkins: pendingCheckins,
      escalations: []
    });
  } catch (err) {
    console.error('Admin clients error:', err.message);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
};
