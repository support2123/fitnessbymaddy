const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: lastCheckin } = await supabase
          .from('checkins')
          .select('week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastCheckin && lastCheckin.week_no >= currentWeek) continue;

        const missedWeeks = lastCheckin
          ? currentWeek - lastCheckin.week_no
          : currentWeek;

        if (missedWeeks >= 3) {
          await escalateToMaddy(
            client.phone,
            `2+ consecutive missed check-ins (${missedWeeks} weeks behind)`,
            `Client: ${client.name || client.phone}, Program: ${client.program}`
          );
        }

        const { data: pendingNudge } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_reminder')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pendingNudge) {
          const hoursSinceNudge = (now - new Date(pendingNudge.sent_at)) / (1000 * 60 * 60);

          if (hoursSinceNudge >= 24 && hoursSinceNudge < 48) {
            const market = detectMarket(client.phone);
            const msg = isHinglish(market)
              ? [`${client.name || 'there'}`, `${currentWeek}`]
              : [`${client.name || 'there'}`, `${currentWeek}`];
            await sendTemplate(client.phone, 'checkin_nudge_24h', msg);
            nudged++;
            continue;
          }

          if (hoursSinceNudge >= 48 && hoursSinceNudge < 72) {
            const market = detectMarket(client.phone);
            const msg = isHinglish(market)
              ? [`${client.name || 'there'}`, `${currentWeek}`]
              : [`${client.name || 'there'}`, `${currentWeek}`];
            await sendTemplate(client.phone, 'checkin_nudge_48h', msg);
            nudged++;
            continue;
          }

          if (hoursSinceNudge < 24) continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);
        const params = isHinglish(market)
          ? [`${client.name || 'there'}`, `${currentWeek}`, checkinUrl]
          : [`${client.name || 'there'}`, `${currentWeek}`, checkinUrl];

        await sendTemplate(client.phone, 'checkin_reminder', params);
        sent++;
      } catch (clientErr) {
        errors.push({ clientId: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      totalClients: activeClients.length,
      sent,
      nudged,
      errors: errors.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
