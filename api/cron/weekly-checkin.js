const { getClient } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    // Allow internal calls too
    if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getClient();
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { data: missed } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmitted = missed && missed.length > 0 ? missed[0].week_no : 0;
        const missedWeeks = weekNo - lastSubmitted - 1;

        if (missedWeeks >= 2) {
          await notifyMaddy(
            '2 Consecutive Missed Check-Ins',
            `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nLast check-in: Week ${lastSubmitted}\nCurrent week: ${weekNo}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        let msg;

        if (isHinglish(market)) {
          msg = `Hey ${client.name || 'there'}! 💪\n\nWeek ${weekNo} ka check-in time aa gaya hai.\n\nYe form fill karo (2 min lagega):\n${checkinUrl}\n\nWeight, waist, energy level, aur progress photos daal dena. Isse hum tumhara plan aur better bana sakte hain!`;
        } else {
          msg = `Hey ${client.name || 'there'}! 💪\n\nTime for your Week ${weekNo} check-in.\n\nFill this out (takes 2 mins):\n${checkinUrl}\n\nAdd your weight, waist, energy level, and progress photos. This helps us optimise your plan!`;
        }

        const result = await sendText(client.phone, msg);
        if (result.ok) sent++;
        else errors.push(maskPhone(client.phone));
      } catch (err) {
        console.error(`[Cron] Error for ${maskPhone(client.phone)}:`, err.message);
        errors.push(maskPhone(client.phone));
      }
    }

    console.log(`[Cron] Weekly check-in: sent=${sent}, errors=${errors.length}`);
    return res.status(200).json({ ok: true, sent, errors: errors.length });
  } catch (err) {
    console.error('[Cron] Weekly check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
