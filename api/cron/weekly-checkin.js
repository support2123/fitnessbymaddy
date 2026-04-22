const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { cors, maskPhone } = require('../../lib/helpers');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const weeksSinceStart = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksSinceStart < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksSinceStart)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksSinceStart}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weeksSinceStart), checkinUrl]
      }, `Week ${weeksSinceStart} check-in time! Fill out your form: ${checkinUrl}`);

      sent++;
    }

    await checkMissedCheckins(supabase);

    console.log(`[Cron/WeeklyCheckin] Sent: ${sent}, Skipped: ${skipped}`);
    return res.status(200).json({ ok: true, sent, skipped });
  } catch (err) {
    console.error('[Cron/WeeklyCheckin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
