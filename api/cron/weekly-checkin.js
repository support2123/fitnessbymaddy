const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { getWeekNumber, isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  let sent = 0;
  let errors = 0;

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients?.length) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    for (const client of clients) {
      try {
        const weekNo = getWeekNumber(client.program_started_at);

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const hinglish = isHinglish(
          (await db.from('leads').select('market').eq('id', client.lead_id).single())?.data?.market
        );

        const msg = hinglish
          ? `Hey ${client.name || 'champ'}! 💪 Week ${weekNo} check-in time!\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos — sab daldo. Isse hum aapka next week ka plan better bana payenge.`
          : `Hey ${client.name || 'champ'}! 💪 Time for your Week ${weekNo} check-in!\n\nSubmit your progress here:\n${checkinUrl}\n\nWeight, waist, photos — everything helps us optimize your next week.`;

        await sendWhatsApp({ phone: client.phone, body: msg });
        sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
