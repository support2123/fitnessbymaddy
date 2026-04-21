const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { createEscalation } = require('../../lib/escalation');
const { json, verifyCronSecret } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, { error: 'GET or POST only' }, 405);
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return json(res, { action: 'no_active_clients' });
    }

    const siteUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';
    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor(
        (now - startDate) / (1000 * 60 * 60 * 24)
      );
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id);

      const expectedCheckins = currentWeek - 1;
      const actualCheckins = missedCount || 0;
      const consecutiveMissed = expectedCheckins - actualCheckins;

      if (consecutiveMissed >= 2) {
        await createEscalation(
          'checkin',
          client.id,
          client.phone,
          `${consecutiveMissed} consecutive missed check-ins`
        );
      }

      const checkinUrl = `${siteUrl}/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${currentWeek}`,
        checkinUrl,
      ]);

      results.push({
        client_id: client.id,
        week: currentWeek,
        sent: true,
      });
    }

    return json(res, {
      action: 'checkins_sent',
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
