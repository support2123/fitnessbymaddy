const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMissed) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          detail: `${client.name} missed weeks ${weekNo - 2} and ${weekNo - 1}`
        });
        escalated++;
      }

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder';

      await sendTemplate(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in reminders sent',
      sent,
      escalated,
      total_clients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
