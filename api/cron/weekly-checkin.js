const { getClient } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { createEscalation, notifyMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getClient();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!inner(market, opted_out)')
      .eq('status', 'active')
      .eq('leads.opted_out', false);

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        results.skipped++;
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await createEscalation(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${maskPhone(client.phone)} missed weeks ${currentWeek - 2} and ${currentWeek - 1}`,
          client.id
        );
        await notifyMaddy(client.phone, '2 missed check-ins', (p, b) => sendText(p, b, true));
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const hinglish = isHinglish(client.leads?.market);

      const message = hinglish
        ? `Week ${currentWeek} check-in time! Apna progress share karo taaki hum next week ka plan adjust kar sakein.\n\n${checkinUrl}`
        : `Time for your Week ${currentWeek} check-in! Share your progress so we can fine-tune next week's plan.\n\n${checkinUrl}`;

      await sendText(client.phone, message, true);
      results.sent++;
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
