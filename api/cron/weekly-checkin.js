const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket, notifyMaddy, maskPhone } = require('../_lib/whatsapp');

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
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

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
        .maybeSingle();

      if (existing) continue;

      const { data: missedWeeks } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedWeeks && missedWeeks.length > 0 ? missedWeeks[0].week_no : 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 missed check-ins',
          `${client.name || maskPhone(client.phone)} missed ${consecutiveMissed} check-ins`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const templateName = market === 'IN' ? 'checkin_reminder_hinglish' : 'checkin_reminder_en';

      await sendTemplate(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`
        ]
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
