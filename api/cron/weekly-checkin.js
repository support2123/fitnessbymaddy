const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) { results.skipped++; continue; }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) { results.skipped++; continue; }

        const { data: lead } = client.lead_id
          ? await db.from('leads').select('market').eq('id', client.lead_id).single()
          : { data: null };

        const market = lead ? lead.market : 'GLOBAL';
        const hinglish = isHinglish(market);
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const msg = hinglish
          ? `Hey ${client.name || 'Champion'}! 💪 Week ${weekNo} ka check-in time!\n\nApna weight, waist, aur progress photos yahan submit karo:\n${checkinUrl}\n\nHonesty = better results. Let's go!`
          : `Hey ${client.name || 'Champion'}! 💪 Time for your Week ${weekNo} check-in!\n\nSubmit your weight, waist, and progress photos here:\n${checkinUrl}\n\nHonesty = better results. Let's go!`;

        await sendText(client.phone, msg);
        results.sent++;
      } catch (err) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    await notifyMaddy('Weekly check-in cron failed', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
