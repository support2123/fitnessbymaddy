const supabase = require('../../lib/supabase');
const { sendText, sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone, programWeeks } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalations = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const totalWeeks = programWeeks(client.program);

      if (currentWeek > totalWeeks) {
        await supabase.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

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

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nLast check-in: Week ${lastSubmittedWeek}`
        );
        escalations++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalations, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
