const { getClient } = require('../../lib/supabase');
const { sendTemplate, sendToMaddy } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  }

  const sb = getClient();

  const { data: activeClients } = await sb
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ ok: true, message: 'No active clients', sent: 0 });
  }

  let sent = 0;
  let errors = 0;

  for (const client of activeClients) {
    try {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missed } = await sb
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const missedWeeks = missed ? weekNo - 1 - missed.length : 0;
      if (missedWeeks >= 2) {
        await sendToMaddy(
          `MISSED CHECKINS\nClient: ${client.name || maskPhone(client.phone)}\nMissed ${missedWeeks} consecutive weeks.\nProgram: ${client.program}`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(detectMarket(client.phone));

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]
      });

      sent++;
    } catch (err) {
      console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
      errors++;
    }
  }

  return res.status(200).json({ ok: true, sent, errors, total: activeClients.length });
};
