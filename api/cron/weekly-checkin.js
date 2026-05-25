const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, checkRateLimit } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const weeksSinceStart = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksSinceStart < 1) continue;

      const { data: latestCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const nextWeek = latestCheckin ? latestCheckin.week_no + 1 : 1;

      if (nextWeek > weeksSinceStart) continue;

      await checkMissedCheckins(client.id);

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${nextWeek}`;

      const limited = await checkRateLimit(client.phone);
      if (!limited) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'Champion',
          String(nextWeek),
          checkinUrl,
        ]);

        results.push({ client_id: client.id, week: nextWeek, sent: true });
      } else {
        results.push({ client_id: client.id, week: nextWeek, sent: false, reason: 'rate_limited' });
      }
    }

    return res.status(200).json({ action: 'checkin_reminders_sent', results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
