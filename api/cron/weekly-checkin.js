const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../../lib/phone');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, nudged: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          params: [
            client.name || 'there',
            `${currentWeek}`,
            formUrl
          ]
        });

        results.sent++;
      } catch (err) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    // Check for missed checkins and escalate
    await checkMissedCheckins(db);

    // Send nudges for clients who got checkin request 24h+ ago but haven't submitted
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) continue;

        // Check if we already sent the checkin request
        const { data: sentMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'weekly_checkin')
          .order('sent_at', { ascending: false })
          .limit(1);

        if (!sentMsg || sentMsg.length === 0) continue;

        const sentAt = new Date(sentMsg[0].sent_at);

        if (sentAt < oneDayAgo && sentAt > twoDaysAgo) {
          const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendWhatsApp({
            phone: client.phone,
            templateName: 'checkin_nudge',
            params: [client.name || 'there', formUrl]
          });
          results.nudged++;
        }
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(client.phone)}:`, err.message);
      }
    }

    return res.json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
