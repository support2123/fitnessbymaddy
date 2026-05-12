const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl
        ]
      });

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const recentWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
      const lastTwoMissing = weekNo >= 3
        && !recentWeeks.includes(weekNo - 1)
        && !recentWeeks.includes(weekNo - 2);

      if (lastTwoMissing) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)} (${client.name || 'unknown'})\nProgram: ${client.program}\nWeek: ${weekNo}`
        );
      }

      results.push({ client_id: client.id, week_no: weekNo });
    }

    return res.status(200).json({
      success: true,
      checkins_sent: results.length,
      details: results
    });

  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
