const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { weeksBetween } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const db = getSupabase();
  const now = new Date();
  let sent = 0;
  let escalated = 0;

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No active clients' });
    }

    for (const client of activeClients) {
      const currentWeek = weeksBetween(client.program_started_at, now);

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
      const missedWeeks = currentWeek - lastCheckedWeek - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          summary: `${client.name || maskPhone(client.phone)} missed ${missedWeeks} check-ins (last: week ${lastCheckedWeek}, current: week ${currentWeek})`,
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `Week ${currentWeek}`,
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({ sent, escalated, total: activeClients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
