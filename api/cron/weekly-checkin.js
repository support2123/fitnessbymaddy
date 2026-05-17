const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastCheckinWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          message: `Client ${client.name || 'unknown'} missed ${consecutiveMissed} check-ins`,
        });
        escalated++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${currentWeek}`,
        checkinUrl,
      ]);
      await logMessage(client.phone, 'out', null, 'weekly_checkin');
      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      escalated,
      total_clients: activeClients.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
