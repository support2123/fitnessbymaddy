const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let processed = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastWeekSubmitted = lastCheckin && lastCheckin[0] ? lastCheckin[0].week_no : 0;

      if (lastWeekSubmitted >= 2 && lastWeekSubmitted < currentWeek - 1) {
        const missedConsecutive = currentWeek - 1 - lastWeekSubmitted;
        if (missedConsecutive >= 2) {
          await escalateToMaddy(
            '2_missed_checkins',
            maskPhone(client.phone),
            `${client.name || 'Client'} missed ${missedConsecutive} consecutive check-ins`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(currentWeek), checkinUrl],
        client.name || 'there'
      );

      processed++;
    }

    return res.json({ ok: true, processed, escalated });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
