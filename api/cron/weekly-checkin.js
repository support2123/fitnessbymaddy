const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let errors = 0;
    const now = new Date();

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const { data: lead } = client.lead_id
          ? await db.from('leads').select('market').eq('id', client.lead_id).single()
          : { data: null };
        const market = lead?.market || 'GLOBAL';

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        if (isHinglish(market)) {
          await sendText(client.phone,
            `Hey ${client.name || 'there'}! 💪 Week ${currentWeek} check-in time!\n\n` +
            `Apna progress update karo:\n${checkinUrl}\n\n` +
            `Weight, waist, photos aur feeling — sab share karo taaki hum next week aur bhi better bana sakein!`
          );
        } else {
          await sendText(client.phone,
            `Hey ${client.name || 'there'}! 💪 Time for your Week ${currentWeek} check-in!\n\n` +
            `Update your progress here:\n${checkinUrl}\n\n` +
            `Share your weight, waist, photos & how you're feeling — so we can make next week even better!`
          );
        }

        sent++;

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        const consecutive = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

        if (consecutive && currentWeek > 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nWeek: ${currentWeek}`
          );
        }
      } catch (clientErr) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ status: 'complete', sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
