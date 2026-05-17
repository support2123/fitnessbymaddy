const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      const startDate = new Date(client.program_started_at);
      const weeksSinceStart = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const currentWeek = weeksSinceStart + 1;

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeekSubmitted = lastCheckin?.week_no || 0;

      if (lastWeekSubmitted >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeekSubmitted - 1;
      if (missedWeeks >= 2) {
        await createEscalation({
          clientId: client.id,
          phone: client.phone,
          reason: `2 consecutive missed check-ins (last: week ${lastWeekSubmitted}, current: week ${currentWeek})`,
          triggerMessage: 'Auto-detected by weekly cron'
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(currentWeek), checkinUrl]
      }, true);

      sent++;
    }

    return res.status(200).json({ success: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
