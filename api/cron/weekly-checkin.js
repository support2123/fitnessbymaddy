const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of clients) {
      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const nextWeek = lastCheckin ? lastCheckin.week_no + 1 : 1;
      const startDate = new Date(client.program_started_at);
      const weeksElapsed = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

      if (nextWeek > weeksElapsed + 1) {
        skipped++;
        continue;
      }

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', nextWeek - 2);

      const expectedCheckins = Math.min(2, nextWeek - 1);
      if (expectedCheckins > 0 && (missedCount || 0) < expectedCheckins - 1) {
        await notifyMaddy(
          '2 missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nLast submitted: Week ${lastCheckin ? lastCheckin.week_no : 0}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${nextWeek}`;

      try {
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          `Week ${nextWeek}`,
          checkinUrl,
        ], client.name);
        sent++;
      } catch (sendErr) {
        console.error('Failed to send checkin to', maskPhone(client.phone), sendErr.message);
        skipped++;
      }
    }

    return res.status(200).json({ sent, skipped, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
