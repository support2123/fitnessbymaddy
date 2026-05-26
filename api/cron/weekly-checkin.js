const { getSupabase } = require('../_utils/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../_utils/whatsapp');
const { isHinglish } = require('../_utils/market');
const { maskPhone } = require('../_utils/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        const currentWeek = lastCheckin ? lastCheckin.week_no + 1 : 1;

        if (lastCheckin && currentWeek - lastCheckin.week_no >= 3) {
          await db.from('escalations').insert({
            phone: client.phone,
            reason: '2+ consecutive missed check-ins',
            message_body: `Client ${client.name} hasn't checked in since week ${lastCheckin.week_no}`
          });
          await notifyMaddy(
            '2+ missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nLast check-in: Week ${lastCheckin.week_no}`
          );
          results.escalated++;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const hinglish = isHinglish(client.phone.startsWith('+91') ? 'IN' : 'GLOBAL');

        if (hinglish) {
          await sendText(client.phone,
            `Hey ${client.name}! Week ${currentWeek} check-in time.\n\n` +
            `Ye form fill karo (2 min lagega):\n${checkinUrl}\n\n` +
            `Weight, waist, photos, aur kaise feel kar rahe ho — sab share karo.`
          );
        } else {
          await sendText(client.phone,
            `Hey ${client.name}! Time for your Week ${currentWeek} check-in.\n\n` +
            `Fill this quick form (takes 2 mins):\n${checkinUrl}\n\n` +
            `Share your weight, waist, photos, and how you're feeling.`
          );
        }

        results.sent++;
      } catch (err) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.json({ success: true, results });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
