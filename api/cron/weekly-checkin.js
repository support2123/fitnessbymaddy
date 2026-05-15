const supabase = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/escalation');
const { isHinglish } = require('../_lib/market');

const SITE_BASE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins && recentCheckins.length > 0
        ? recentCheckins[0].week_no : 0;

      if (weekNo - lastCheckinWeek >= 3) {
        await notifyMaddy(
          '2 Consecutive Missed Check-ins',
          `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nLast check-in: Week ${lastCheckinWeek}\nCurrent week: ${weekNo}`
        );
        escalated++;
      }

      const checkinUrl = `${SITE_BASE}/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.leads ? client.leads.market : 'GLOBAL';

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      }
      sent++;
    }

    return res.json({ action: 'weekly_checkin_sent', sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
