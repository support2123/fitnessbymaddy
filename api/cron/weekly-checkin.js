const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          results.skipped++;
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
        let consecutiveMissed = 0;
        for (let w = weekNo - 1; w >= Math.max(1, weekNo - 2); w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)} | Program: ${client.program} | Week ${weekNo}`
          );
          results.escalated++;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'weekly_checkin_hi', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ]);
        } else {
          await sendTemplate(client.phone, 'weekly_checkin_en', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ]);
        }

        results.sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ message: 'Weekly check-in cron complete', ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
