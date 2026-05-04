const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');
const { escalate } = require('../lib/escalate');
const { detectMarket, isHinglishMarket, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.json({ message: 'No active clients', ...results });
  }

  for (const client of clients) {
    try {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) {
        results.skipped++;
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedCount = weekNo - 1 - (missedCheckins?.length || 0);
      if (missedCount >= 2) {
        await escalate(
          client.phone,
          '2_consecutive_missed_checkins',
          `Client ${maskPhone(client.phone)} missed ${missedCount} check-ins`
        );
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglishMarket(market) ? 'weekly_checkin_hi' : 'weekly_checkin_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      results.sent++;
    } catch (err) {
      console.error(`Checkin send failed for ${maskPhone(client.phone)}: ${err.message}`);
      results.errors++;
    }
  }

  console.log(`Weekly checkin cron: ${JSON.stringify(results)}`);
  return res.json({ success: true, ...results });
};
