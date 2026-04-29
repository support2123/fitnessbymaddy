const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isVercel = req.headers['x-vercel-cron'] === '1';
  if (!isCron && !isVercel) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // FLOW A step 3: Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there'],
        });
        nudged++;
      }
    }

    // FLOW A step 4: Drop leads with no reply in 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    // Re-engage dropped leads (7-day rule: only those dropped 7+ days ago, max once)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! 👋 Maddy ki team se — abhi bhi fitness goals pe kaam karna hai? Ek $20 trial session se start karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" to opt out.`
          : `Hey ${lead.name || 'there'}! 👋 From Maddy's team — still working on your fitness goals? Start with a $20 trial session: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" to opt out.`;

        await sendText(lead.phone, msg);
        reEngaged++;
      }
    }

    // Nudge clients who haven't submitted check-ins (+24h and +48h)
    const oneDayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;
    const twoDaysAgoMs = now.getTime() - 48 * 60 * 60 * 1000;

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      const sunday = new Date(now);
      sunday.setDate(sunday.getDate() - sunday.getDay());
      sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC

      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const hoursSinceSunday = (now - sunday) / (1000 * 60 * 60);
        if (hoursSinceSunday < 24 || hoursSinceSunday > 72) continue;

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Reminder! 📋 Week ${weekNo} check-in abhi tak pending hai.\n\n${checkinUrl}\n\nBas 2 min lagega — tracking se results aate hain!`
          : `Reminder! 📋 Your Week ${weekNo} check-in is still pending.\n\n${checkinUrl}\n\nTakes just 2 mins — tracking drives results!`;

        await sendText(client.phone, msg);
        checkinNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged_new_leads: nudged,
      re_engaged: reEngaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
