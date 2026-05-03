const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && !isVercelCron && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, lead:leads(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastCheckedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalate({
          phone: client.phone,
          reason: `2 consecutive missed check-ins (weeks ${lastCheckedWeek + 1}-${weekNo - 1})`,
          messageBody: `Client ${client.name || client.phone} missed ${consecutiveMissed} consecutive check-ins`
        });
        escalated++;
      }

      const market = client.lead?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: hinglish
          ? `Hey ${client.name || 'Champion'}! 💪 Week ${weekNo} check-in time! Apna progress update karo — weight, measurements, aur photos.\n\n📋 Form: ${checkinUrl}\n\n5 min lagega, aur Maddy tera next week ka plan isse better bana sakti hai!`
          : `Hey ${client.name || 'Champion'}! 💪 Time for your Week ${weekNo} check-in! Update your progress — weight, measurements, and photos.\n\n📋 Form: ${checkinUrl}\n\nTakes 5 minutes, and helps Maddy make your next week even better!`,
        params: [client.name || 'Champion', String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
