const { getSupabase } = require('../_lib/supabase');
const { sendText, sendTemplate, canSend } = require('../_lib/whatsapp');
const { escalateMissedCheckins } = require('../_lib/escalation');
const { isHinglish, weeksBetween } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = { sent: 0, skipped: 0, nudged: 0, escalated: 0 };

    for (const client of clients) {
      const weekNo = weeksBetween(client.program_started_at, now) + 1;

      if (weekNo < 1) continue;

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

      const prevWeek = weekNo - 1;
      if (prevWeek > 0) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek)
          .single();

        if (!prevCheckin) {
          const { count } = await db
            .from('checkins')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .gte('week_no', prevWeek - 1)
            .lte('week_no', prevWeek);

          if (count === 0) {
            await escalateMissedCheckins(client.id, client.name, client.phone, 2);
            results.escalated++;
          }
        }
      }

      const siteBase = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';
      const checkinUrl = `${siteBase}/checkin?c=${client.id}&w=${weekNo}`;

      const market = client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
      const hinglish = isHinglish(market);

      const allowed = await canSend(client.phone, true);
      if (!allowed) {
        results.skipped++;
        continue;
      }

      if (hinglish) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} check-in time.\n\n` +
          `Apna progress yahan submit karo:\n${checkinUrl}\n\n` +
          `Weight, waist, photos aur kaise feel kar rahe ho — sab batao!`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\n` +
          `Submit your progress here:\n${checkinUrl}\n\n` +
          `Weight, waist, photos, and how you're feeling — let's see those gains!`
        );
      }

      results.sent++;
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('[Cron WeeklyCheckin] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
