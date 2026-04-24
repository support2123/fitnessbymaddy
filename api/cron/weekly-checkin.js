const { getSupabase } = require('../lib/supabase');
const { sendText, sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}` ||
                   authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const escalations = [];

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
        .maybeSingle();

      if (existing) continue;

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length >= 2) {
        const lastWeek = lastTwo[0].week_no;
        const prevWeek = lastTwo[1].week_no;
        if (weekNo - lastWeek >= 2 && weekNo - prevWeek >= 3) {
          escalations.push(client);
        }
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendText(
          client.phone,
          `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in time!\n\n` +
          `Apna progress update karo — weight, waist, photos, aur kaise feel kar rahe ho.\n\n` +
          `Form: ${checkinUrl}\n\n` +
          `Ye important hai taaki hum aapka plan sahi tarike se adjust kar sakein. 💪`
        );
      } else {
        await sendText(
          client.phone,
          `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in time!\n\n` +
          `Update your progress — weight, waist, photos, and how you're feeling.\n\n` +
          `Form: ${checkinUrl}\n\n` +
          `This helps us fine-tune your plan for maximum results. 💪`
        );
      }

      sent++;
    }

    for (const client of escalations) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${maskPhone(client.phone)}\nName: ${client.name || 'Unknown'}\nProgram: ${client.program}`
      );
    }

    return res.status(200).json({ ok: true, sent, escalations: escalations.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
