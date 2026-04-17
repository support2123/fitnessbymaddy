const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins && missedCheckins.length > 0
        ? missedCheckins[0].week_no : 0;
      const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)}, Name: ${client.name || 'Unknown'}, Program: ${client.program}, Missed weeks: ${consecutiveMissed}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        currentWeek.toString(),
        checkinUrl
      ]);

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week=${currentWeek}`);
    }

    return res.status(200).json({ sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
