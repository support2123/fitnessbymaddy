const { getSupabase } = require('../../lib/supabase');
const { sendText, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        const { notifyMaddy } = require('../../lib/whatsapp');
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${client.id})\nMissed weeks: ${consecutiveMissed}`
        );
      }

      if (await canSendMessage(client.phone)) {
        const isIN = client.phone.startsWith('91');
        const msg = isIN
          ? `Hey ${client.name || 'there'}! 💪 Week ${currentWeek} check-in time. Apna progress share karo:\n\n${checkinUrl}`
          : `Hey ${client.name || 'there'}! 💪 Time for your Week ${currentWeek} check-in. Share your progress:\n\n${checkinUrl}`;
        await sendText(client.phone, msg);
        sent++;
      }
    }

    return res.json({ success: true, sent, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
