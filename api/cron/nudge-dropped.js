const { supabase } = require('../lib/supabase');
const { sendWhatsApp, canSendMessage, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2-hour nudge for new leads
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (newLeads || [])) {
      if (await canSendMessage(lead.phone)) {
        const market = detectMarket(lead.phone);
        const msg = market === 'IN'
          ? `Btw — agar confuse ho, toh $20 ka Zoom trial try karo. No commitment: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
          : `Not sure yet? Try a $20 Zoom trial — no commitment: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

        await sendWhatsApp({ phone: lead.phone, templateName: 'nudge_trial', body: msg });
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    // Nudge active clients with missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!checkin || checkin.length === 0) {
        const { data: lastNudge } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .ilike('body', '%check-in%')
          .order('sent_at', { ascending: false })
          .limit(1);

        const lastNudgeTime = lastNudge?.[0]?.sent_at;
        const shouldNudge = !lastNudgeTime ||
          (now - new Date(lastNudgeTime)) > 24 * 60 * 60 * 1000;

        if (shouldNudge && await canSendMessage(client.phone)) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp({
            phone: client.phone,
            body: `Reminder: your Week ${weekNo} check-in is pending! Don't skip it — ${checkinUrl}`
          });
          clientNudged++;
        }

        // Escalate after 2 consecutive missed check-ins
        if (weekNo >= 2) {
          const { data: prevCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .limit(1);

          if ((!checkin || checkin.length === 0) && (!prevCheckin || prevCheckin.length === 0)) {
            const { createEscalation } = require('../lib/escalation');
            await createEscalation(
              client.phone,
              '2_consecutive_missed_checkins',
              `${client.name} missed Week ${weekNo - 1} and Week ${weekNo} check-ins.`
            );
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped, clientNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
