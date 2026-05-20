const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (only try once)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    const results = { nudged: 0, skipped: 0 };

    for (const lead of droppedLeads || []) {
      // Check if we already sent a re-engagement
      const { data: priorNudge } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (priorNudge && priorNudge.length > 0) {
        results.skipped++;
        continue;
      }

      const { isHinglish } = require('../../lib/market');
      const hinglish = isHinglish(lead.market);

      await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name ? lead.name.split(' ')[0] : (hinglish ? 'Friend' : 'there'),
        hinglish
          ? 'Maddy ke paas ek special $20 trial session hai — ek baar try karo!'
          : 'Maddy has a special $20 trial session — give it a try!'
      ]);

      console.log(`Re-engagement sent to ${maskPhone(lead.phone)}`);
      results.nudged++;
    }

    // Also nudge clients who haven't submitted this week's check-in
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const isSunday = new Date().getDay() === 0;
    const isMonday = new Date().getDay() === 1;
    const isTuesday = new Date().getDay() === 2;

    if (isMonday || isTuesday) {
      const { data: activeClients } = await supabase
        .from('clients')
        .select('*')
        .eq('status', 'active');

      for (const client of activeClients || []) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        const { data: thisWeekCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!thisWeekCheckin || thisWeekCheckin.length === 0) {
          const nudgeTemplate = isMonday ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
          await sendTemplate(client.phone, nudgeTemplate, [
            client.name ? client.name.split(' ')[0] : 'there',
            String(currentWeek),
            `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`
          ], true);
        }
      }
    }

    return res.status(200).json({ ok: true, ...results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
