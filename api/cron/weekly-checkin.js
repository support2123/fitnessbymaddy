const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy, maskPhone } = require('../lib/whatsapp');

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
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalations = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}, Program: ${client.program}, Last check-in: Week ${lastSubmittedWeek}`
        );
        escalations++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `Week ${weekNo}`,
        checkinUrl
      ]);

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalations, total: activeClients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
