const supabase = require('../../lib/supabase');
const { programWeekCount } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    const pending = [];
    const now = Date.now();

    for (const client of (clients || [])) {
      const startDate = new Date(client.program_started_at).getTime();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const maxWeeks = programWeekCount(client.program);

      if (currentWeek < 1 || currentWeek > maxWeeks) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        pending.push({
          name: client.name,
          phone: client.phone,
          program: client.program,
          week_no: currentWeek
        });
      }
    }

    return res.status(200).json(pending);
  } catch (err) {
    console.error('[Admin/PendingCheckins]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
