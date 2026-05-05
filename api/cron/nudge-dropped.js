const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV !== 'development') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of staleNew || []) {
      const market = detectMarket(lead.phone);
      const templateName = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      nudged++;
    }

    const { data: expiredNew } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of expiredNew || []) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, name, phone, program_started_at')
      .eq('status', 'active');

    let missedCheckinAlerts = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysDiff / 7);

      if (currentWeek < 2) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      const missedConsecutive =
        !submittedWeeks.includes(currentWeek) && !submittedWeeks.includes(currentWeek - 1);

      if (missedConsecutive) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)}), missed weeks ${currentWeek - 1} and ${currentWeek}`
        );
        missedCheckinAlerts++;
      }

      if (!submittedWeeks.includes(currentWeek)) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const daysSinceCheckinDue = daysDiff % 7;
        if (daysSinceCheckinDue === 1 || daysSinceCheckinDue === 2) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            `${currentWeek}`,
            checkinUrl
          ]);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      missed_checkin_alerts: missedCheckinAlerts
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
