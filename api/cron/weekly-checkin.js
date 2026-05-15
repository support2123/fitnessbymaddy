const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText, canSendMessage } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const { data: lead } = client.lead_id
        ? await supabase.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead?.market || 'GLOBAL';

      const allowed = await canSendMessage(client.phone, true);
      if (!allowed) { skipped++; continue; }

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} check-in time ho gaya.\n\n` +
          `Ye form fill karo: ${checkinUrl}\n\n` +
          `Weight, measurements aur photos daalo — hum aapka next week plan bana denge!`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\n` +
          `Fill out the form: ${checkinUrl}\n\n` +
          `Include your weight, measurements and progress photos — we'll build your next week's plan!`
        );
      }
      sent++;
    }

    return res.status(200).json({ ok: true, sent, skipped, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
