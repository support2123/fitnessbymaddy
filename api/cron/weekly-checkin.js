const { getClient } = require('../../lib/supabase');
const { sendText, sendTemplate } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

const SITE = 'https://fitnessbymaddy.com';
const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      const actualCheckins = missedCount || 0;

      if (expectedCheckins - actualCheckins >= 2) {
        await sendTemplate(MADDY_PHONE, 'escalation_alert', [
          client.name || client.phone,
          `2 consecutive missed check-ins (week ${weekNo})`,
        ]);
        escalated++;
      }

      const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg =
        market === 'IN'
          ? `Hey ${client.name || 'there'}! 💪 Week ${weekNo} check-in time.\n\n📋 Form yahan fill karo: ${checkinUrl}\n\nWeight, waist, photos, aur week kaisa raha — sab daal do. Isse next week ka plan aur better banega!`
          : `Hey ${client.name || 'there'}! 💪 Time for your Week ${weekNo} check-in.\n\n📋 Fill it out here: ${checkinUrl}\n\nWeight, waist, photos, and how your week went — this helps us optimise your next week!`;

      await sendText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
