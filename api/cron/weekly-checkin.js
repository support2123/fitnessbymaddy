const { getClient } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { logMessage, isOptedOut } = require('../../lib/messages');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getClient();
    const { data: clients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        if (await isOptedOut(client.phone)) {
          skipped++;
          continue;
        }

        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        const programWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > programWeeks) {
          await sb.from('clients').update({ status: 'completed' }).eq('id', client.id);
          skipped++;
          continue;
        }

        const { data: existing } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        const { data: missed } = await sb
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastCheckinWeek = missed && missed.length > 0 ? missed[0].week_no : 0;
        const consecutiveMissed = weekNo - lastCheckinWeek - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            name: client.name,
            message: `Missed weeks ${lastCheckinWeek + 1} to ${weekNo - 1}`,
          });
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl,
        ]);
        await logMessage(client.phone, 'out', `Week ${weekNo} check-in form sent`, 'weekly_checkin');
        sent++;
      } catch (clientErr) {
        console.error(`[CRON_CHECKIN] Error for ${maskPhone(client.phone)}:`, clientErr.message);
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    console.log(`[CRON_CHECKIN] Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors.length}`);
    return res.status(200).json({ sent, skipped, errors: errors.length });
  } catch (err) {
    console.error('[CRON_CHECKIN]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
