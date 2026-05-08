const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalateMissedCheckins } = require('../../lib/escalate');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      const missedConsecutive = [currentWeek - 1, currentWeek - 2].filter(w => w > 0 && !submittedWeeks.includes(w)).length;

      if (missedConsecutive >= 2) {
        await escalateMissedCheckins(client.name, client.phone, missedConsecutive);
        escalated++;
      }

      const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${currentWeek}`;

      if (await canSendMessage(client.phone, true)) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
        sent++;
      }
    }

    return res.status(200).json({ message: 'Weekly check-in cron complete', sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
