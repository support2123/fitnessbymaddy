const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      if (currentWeek > 2 && (missedCount || 0) === 0) {
        await createEscalation(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || client.id} has missed 2+ consecutive check-ins.`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'weekly_checkin_hi', [
          client.name || 'Champion',
          String(currentWeek),
          checkinUrl,
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'Champion',
          String(currentWeek),
          checkinUrl,
        ]);
      }

      results.push({ client_id: client.id, week: currentWeek, action: 'sent' });
    }

    return res.status(200).json({ action: 'completed', count: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
