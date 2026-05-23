const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: latestCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastSubmittedWeek = latestCheckin?.week_no || 0;

      if (lastSubmittedWeek >= currentWeek) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const missedWeeks = currentWeek - lastSubmittedWeek - 1;
      if (missedWeeks >= 2) {
        await createEscalation(
          client.phone,
          '2_consecutive_missed_checkins',
          `Client ${client.name || client.id} missed ${missedWeeks} consecutive check-ins`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `Week ${currentWeek}`,
        checkinUrl
      ]);

      results.push({ client_id: client.id, action: 'sent', week: currentWeek });
    }

    return res.json({ processed: results.length, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
