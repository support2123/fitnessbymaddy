const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, name, phone, program, program_started_at, status')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!clients || clients.length === 0) {
      return res.status(200).json([]);
    }

    const enriched = [];
    for (const client of clients) {
      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      enriched.push({
        name: client.name,
        phone: client.phone,
        program: client.program,
        program_started_at: client.program_started_at,
        status: client.status,
        last_checkin: lastCheckin && lastCheckin[0]
          ? `Week ${lastCheckin[0].week_no}`
          : null
      });
    }

    return res.status(200).json(enriched);
  } catch (err) {
    console.error('Admin clients error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
