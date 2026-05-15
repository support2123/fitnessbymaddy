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
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const recentWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoExpected = [currentWeek - 1, currentWeek - 2].filter(w => w > 0);
      const missedConsecutive = lastTwoExpected.length >= 2 &&
        lastTwoExpected.every(w => !recentWeeks.includes(w));

      if (missedConsecutive) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          details: `Client ${client.name || 'unknown'}, program: ${client.program}`
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]
      });
      sent++;
    }

    return res.json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
