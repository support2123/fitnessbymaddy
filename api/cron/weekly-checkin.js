const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, market:leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missed } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const missedConsecutive = lastTwoWeeks.every(
        (w) => w > 0 && (!missed || !missed.find((c) => c.week_no === w))
      );

      if (missedConsecutive && weekNo > 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name || 'Unknown'}, Week ${weekNo}`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.market?.[0]?.market || 'GLOBAL';

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time aa gaya hai.\n\n` +
          `Yeh form fill karo — weight, waist, photos aur kaise feel kar rahe ho:\n${checkinUrl}\n\n` +
          `Consistency hi key hai! 💪`,
          true
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! It's time for your Week ${weekNo} check-in.\n\n` +
          `Fill out this form — weight, waist, photos and how you're feeling:\n${checkinUrl}\n\n` +
          `Consistency is key! 💪`,
          true
        );
      }

      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
