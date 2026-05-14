const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/helpers');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
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

      if (existingCheckin && existingCheckin.length > 0) {
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const consecutiveMisses = lastTwoWeeks.filter(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMisses.length >= 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          clientName: client.name,
          details: `Client has missed weeks ${consecutiveMisses.join(', ')}`
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const isHinglish = market === 'IN';

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${currentWeek}`;

      const msg = isHinglish
        ? `Hey ${client.name || 'Champion'}! Week ${currentWeek} ka check-in time hai. Apna progress update karo: ${checkinUrl}`
        : `Hey ${client.name || 'Champion'}! Time for your Week ${currentWeek} check-in. Update your progress here: ${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'Champion', String(currentWeek), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in reminders sent',
      total_clients: activeClients.length,
      sent,
      escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
