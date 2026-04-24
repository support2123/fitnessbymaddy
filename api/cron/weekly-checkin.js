const supabase = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

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
        await notifyMaddy(
          '2 Consecutive Missed Check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nMissed weeks: ${missedWeeks}\nLast check-in: Week ${lastWeekSubmitted}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl,
        ],
      });

      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      escalated,
      total_active: activeClients.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
