const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('*')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastWeekSubmitted = lastCheckin?.[0]?.week_no || 0;

      if (lastWeekSubmitted >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeekSubmitted - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nMissed: ${missedWeeks} weeks`
        );
        escalated++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const params = [`Hi ${client.name}! Time for your Week ${currentWeek} check-in: ${checkinUrl}`];
      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      nudged,
      escalated,
      total_clients: activeClients.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
