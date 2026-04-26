const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= weekNo) continue;

      const missedWeeks = weekNo - lastWeek - 1;
      if (missedWeeks >= 2) {
        await sendEscalation(
          '2_consecutive_missed_checkins',
          client.phone,
          `${client.name || 'Client'} missed ${missedWeeks} consecutive check-ins (Week ${lastWeek + 1} to ${weekNo - 1})`
        );
        escalated++;
      }

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

      const hinglish = isHinglish(client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL');
      const body = hinglish
        ? `Hey ${client.name || 'Champion'}! Week ${weekNo} check-in ka time hai. Apna progress share karo taaki hum aapka plan update kar sakein:\n${checkinUrl}`
        : `Hey ${client.name || 'Champion'}! Time for your Week ${weekNo} check-in. Share your progress so we can update your plan:\n${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body,
        params: [client.name || 'Champion', weekNo.toString(), checkinUrl],
        isClient: true
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron completed',
      sent,
      escalated,
      totalClients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}
