const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/constants');
const { isHinglishMarket } = require('../../lib/market');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead:leads(market)')
      .eq('status', 'active');

    if (error) {
      console.error('[Cron] Fetch clients error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      if (weekNo < 1) { skipped++; continue; }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const missedWeeks = missedCheckins ? weekNo - 1 - missedCheckins.length : 0;
      if (missedWeeks >= 2) {
        await notifyMaddy(`${client.name || maskPhone(client.phone)} has missed ${missedWeeks} consecutive check-ins`);
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.lead?.market || 'GLOBAL';

      if (isHinglishMarket(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 💪\n\n` +
          `Apna progress share karo — weight, waist, photos aur kaise feel kar rahe ho:\n${checkinUrl}\n\n` +
          `5 min lagega bas!`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 💪\n\n` +
          `Share your progress — weight, waist, photos, and how you're feeling:\n${checkinUrl}\n\n` +
          `Takes just 5 minutes!`
        );
      }

      sent++;
    }

    return res.status(200).json({ ok: true, sent, skipped, total: activeClients?.length || 0 });
  } catch (err) {
    console.error('[Cron Weekly Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
