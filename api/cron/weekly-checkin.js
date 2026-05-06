const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');
const { checkConsecutiveMissed } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.headers['x-vercel-cron'] !== '1' && !process.env.VERCEL) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'no active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) {
          skipped++;
          continue;
        }

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        await checkConsecutiveMissed(client.id);

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl,
        ]);

        sent++;
      } catch (err) {
        console.error(`[CRON] Error for ${maskPhone(client.phone)}:`, err.message);
        errors.push(maskPhone(client.phone));
      }
    }

    console.log(`[CRON weekly-checkin] Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors.length}`);
    return res.status(200).json({ sent, skipped, errors: errors.length });
  } catch (err) {
    console.error('[CRON weekly-checkin ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
