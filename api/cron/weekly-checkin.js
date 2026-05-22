const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-vercel-cron'] !== '1') {
    if (req.headers['x-internal-key'] !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missedWeeks } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedWeeks?.[0]?.week_no || 0;
      const missedCount = weekNo - lastSubmittedWeek - 1;

      if (missedCount >= 2) {
        await createEscalation({
          sourceType: 'missed_checkin',
          sourceId: client.id,
          phone: client.phone,
          reason: '2_consecutive_missed',
          details: `Client missed ${missedCount} check-ins. Last submitted: week ${lastSubmittedWeek}`
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.market || 'IN');

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress update karo:\n${checkinUrl}`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress here:\n${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        isClient: true
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
