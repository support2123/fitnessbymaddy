const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isCron = req.headers['x-vercel-cron'] === '1';

  if (!isCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
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
        .single();

      if (existing) continue;

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length >= 2) {
        const expectedWeeks = [weekNo - 1, weekNo - 2];
        const submittedWeeks = lastTwo.map(c => c.week_no);
        const missed = expectedWeeks.filter(w => !submittedWeeks.includes(w));
        if (missed.length >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `${client.name} missed weeks ${missed.join(', ')}`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('+91') ? 'IN' : 'GLOBAL';

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      }

      sent++;
    }

    return res.status(200).json({
      success: true,
      clients_total: clients.length,
      checkins_sent: sent,
      escalations: escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
