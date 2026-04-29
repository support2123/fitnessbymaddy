const { getSupabase } = require('../_lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at, status')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = { sent: 0, skipped: 0, nudged: 0, escalated: 0 };

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        results.skipped++;
        continue;
      }

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastSubmittedWeek = lastCheckin?.week_no || 0;

      if (lastSubmittedWeek >= currentWeek) {
        results.skipped++;
        continue;
      }

      const missedWeeks = currentWeek - lastSubmittedWeek - 1;

      if (missedWeeks >= 2) {
        await notifyMaddy(
          '2+ missed check-ins',
          `Client: ${client.name}\nPhone: ${maskPhone(client.phone)}\nMissed weeks: ${missedWeeks}\nProgram: ${client.program}`
        );
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplateForced(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);

      results.sent++;

      if (lastCheckin) {
        const lastSubmitDate = new Date(lastCheckin.form_submitted_at);
        const hoursSinceSubmit = (Date.now() - lastSubmitDate.getTime()) / (1000 * 60 * 60);

        if (hoursSinceSubmit > 24 * 7 + 24 && hoursSinceSubmit < 24 * 7 + 48) {
          results.nudged++;
        }
      }
    }

    return res.status(200).json({ ok: true, results });

  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
