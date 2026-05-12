const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getSupabase();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weeksSinceStart = Math.floor(
          (now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const { data: lastCheckin } = await db
          .from('checkins')
          .select('*')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeek = lastCheckin?.[0]?.week_no || 0;

        if (lastWeek >= 2 && (weeksSinceStart - lastWeek) >= 2) {
          const { data: prevCheckins } = await db
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .order('week_no', { ascending: false })
            .limit(3);

          const weekNos = prevCheckins?.map(c => c.week_no) || [];
          const missed = [];
          for (let w = weeksSinceStart; w > weeksSinceStart - 3 && w > 0; w--) {
            if (!weekNos.includes(w)) missed.push(w);
          }

          if (missed.length >= 2) {
            await escalateToMaddy({
              reason: '2 consecutive missed check-ins',
              phone: client.phone,
              clientName: client.name,
              details: `Missed weeks: ${missed.join(', ')}`,
            });
            results.escalated++;
          }
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksSinceStart}`;
        const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
        const hinglish = isHinglish(market);

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: hinglish
            ? [client.name || 'there', weeksSinceStart.toString(), checkinUrl]
            : [client.name || 'there', weeksSinceStart.toString(), checkinUrl],
        });

        results.sent++;

      } catch (err) {
        console.error('Check-in send error:', err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed', results });
  }
};
