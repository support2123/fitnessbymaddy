const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json([]);
    }

    const pending = [];
    const now = new Date();

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysDiff / 7));

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin && daysDiff > 0) {
        const dueDate = new Date(startDate.getTime() + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000);
        const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

        pending.push({
          name: client.name,
          phone: client.phone,
          program: client.program,
          week_no: currentWeek,
          due_since: daysOverdue <= 0 ? 'Today' : daysOverdue + 'd overdue'
        });
      }
    }

    return res.status(200).json(pending);
  } catch (err) {
    console.error('Admin pending error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
