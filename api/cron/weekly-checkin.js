const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalate } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existing && existing.length > 0) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalate(
          client.phone,
          `2 consecutive missed check-ins (weeks ${lastSubmittedWeek + 1}-${currentWeek - 1})`,
          `Client ${client.name || client.id} has missed ${consecutiveMissed} check-ins.`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const allowed = await canSendMessage(client.phone);
      if (allowed) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl,
        ]);
        results.push({ client_id: client.id, status: 'sent', week: currentWeek });
      } else {
        results.push({ client_id: client.id, status: 'rate_limited' });
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
