const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');
const { detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  let sent = 0;
  let escalated = 0;

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.json({ ok: true, sent: 0 });
    }

    for (const client of activeClients) {
      const weeksSinceStart = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksSinceStart)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weeksSinceStart - 2);

      const expectedCheckins = Math.min(weeksSinceStart, 2);
      if (expectedCheckins - (missedCount || 0) >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name || 'unknown'}, Week ${weeksSinceStart}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksSinceStart}`;
      const market = detectMarket(client.phone);

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${weeksSinceStart}`,
        checkinUrl,
      ]);

      sent++;
    }

    return res.json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
