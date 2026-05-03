const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
        const consecutiveMissed = weekNo - lastSubmitted - 1;

        if (consecutiveMissed >= 2) {
          await notifyMaddy(
            `2 missed check-ins — ${client.name}`,
            `${client.name} (${maskPhone(client.phone)}) has missed ${consecutiveMissed} consecutive check-ins.\nProgram: ${client.program}\nLast submitted: Week ${lastSubmitted}`
          );
        }

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
        const hinglish = isHinglish(client.phone);

        if (hinglish) {
          await sendWhatsApp(client.phone, 'weekly_checkin_hi', [
            client.name || 'Champion',
            String(weekNo),
            checkinUrl,
          ]);
        } else {
          await sendWhatsApp(client.phone, 'weekly_checkin_en', [
            client.name || 'Champion',
            String(weekNo),
            checkinUrl,
          ]);
        }

        sent++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.json({ sent, skipped, errors: errors.length, details: errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
