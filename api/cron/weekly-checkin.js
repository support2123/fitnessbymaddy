const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const weeksSinceStart = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      );

      const currentWeek = Math.max(1, weeksSinceStart);

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          `${currentWeek}`,
          checkinUrl
        ]
      });
      sent++;

      const { data: prevWeekCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek - 1)
        .limit(1);

      if ((!prevWeekCheckin || prevWeekCheckin.length === 0) && currentWeek > 1) {
        nudged++;
      }
    }

    await checkMissedCheckins();

    return res.status(200).json({ sent, nudged, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
