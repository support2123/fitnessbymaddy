const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/messages');
const { maskPhone } = require('../../lib/utils');

const MADDY_PHONE = '917082478374';
const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        const missedWeeks = lastCheckin
          ? currentWeek - lastCheckin.week_no - 1
          : currentWeek - 1;

        if (missedWeeks >= 2) {
          await sendText(MADDY_PHONE,
            `⚠️ ${client.name} (${maskPhone(client.phone)}) has missed ${missedWeeks} consecutive check-ins. Please follow up.`
          );
          await logMessage(MADDY_PHONE, 'out', 'Missed checkins alert', 'missed_checkins');
          results.escalated++;
        }

        const formLink = `${SITE}/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = client.market || 'GLOBAL';

        const msg = market === 'IN'
          ? `Hey ${client.name}! 🏋️ Week ${currentWeek} check-in time! Ye form fill karo:\n${formLink}\n\nWeight, waist, photos — sab dalke progress track karo!`
          : `Hey ${client.name}! 🏋️ Time for your Week ${currentWeek} check-in!\n${formLink}\n\nLog your weight, waist, photos — let's track your progress!`;

        await sendTemplate(client.phone, 'weekly_checkin', [client.name, String(currentWeek), formLink]);
        await logMessage(client.phone, 'out', msg, 'weekly_checkin');
        results.sent++;
      } catch (err) {
        console.error(`Checkin cron error for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
