const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { getCurrentWeek, generateToken, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = { sent: 0, skipped: 0, errors: 0 };

    for (const client of activeClients) {
      try {
        const weekNo = getCurrentWeek(client.program_started_at);

        const maxWeeks = client.program === '12wk' ? 12
          : client.program?.startsWith('6wk') ? 6
          : client.program === 'pcos' ? 6
          : client.program === '40plus' ? 6
          : client.program === 'zoom_trial' ? 1
          : 4;

        if (weekNo > maxWeeks) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const token = generateToken(client.id, weekNo);
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}&t=${token}`;

        await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]
        });

        results.sent++;
      } catch (err) {
        console.error(`Checkin send error for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    if (results.errors > 0) {
      await notifyMaddy(
        'Weekly check-in cron errors',
        `Sent: ${results.sent}, Skipped: ${results.skipped}, Errors: ${results.errors}`
      );
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
