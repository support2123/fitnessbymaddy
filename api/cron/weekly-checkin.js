const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { escalate } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = { sent: 0, skipped: 0, nudged: 0, escalated: 0 };

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor(
        (Date.now() - startDate.getTime()) / 86400000
      );
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        results.skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastSubmitted - 1;

      if (consecutiveMissed >= 2) {
        await escalate(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || client.id} missed ${consecutiveMissed} weeks`
        );
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const hinglish = isHinglish(
        client.phone.startsWith('+91') ? 'IN' : 'GLOBAL'
      );

      await sendWhatsApp({
        phone: client.phone,
        templateName: hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en',
        bodyValues: [client.name || 'there', String(currentWeek), checkinUrl],
      });

      results.sent++;
    }

    return res.status(200).json({ message: 'Weekly check-in cron complete', results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
