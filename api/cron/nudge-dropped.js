const { getSupabase } = require('../../lib/supabase');
const { sendRateLimited } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back')
        .limit(1);

      if (recentMessages && recentMessages.length > 0) {
        results.push({ lead_id: lead.id, action: 'already_nudged' });
        continue;
      }

      const market = detectMarket(lead.phone);
      const trialLink = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial';

      let msg;
      if (isHinglish(market)) {
        msg = `Hey ${lead.name || 'there'}! Maddy ka $20 trial session try karo - ek Zoom call mein samjho kaise transform hona hai. Book karo: ${trialLink}`;
      } else {
        msg = `Hey ${lead.name || 'there'}! Try Maddy's $20 trial session - one Zoom call to see how transformation works. Book here: ${trialLink}`;
      }

      const result = await sendRateLimited(
        lead.phone,
        'win_back',
        [lead.name || 'there', trialLink],
        msg
      );

      results.push({
        lead_id: lead.id,
        action: result.success ? 'nudged' : 'rate_limited',
      });
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at, template_name')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg) continue;

        const hoursSinceLastMsg = (Date.now() - new Date(lastMsg.sent_at)) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 48 && lastMsg.template_name === 'weekly_checkin') {
          const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          const market = detectMarket(client.phone);

          let nudgeMsg;
          if (isHinglish(market)) {
            nudgeMsg = `Reminder: Week ${weekNo} ka check-in abhi tak pending hai. Jaldi update karo: ${checkinLink}`;
          } else {
            nudgeMsg = `Reminder: Your Week ${weekNo} check-in is still pending. Please update here: ${checkinLink}`;
          }

          await sendRateLimited(client.phone, 'checkin_nudge_1', [String(weekNo), checkinLink], nudgeMsg);
        }

        if (hoursSinceLastMsg >= 48 && hoursSinceLastMsg < 72 && lastMsg.template_name === 'checkin_nudge_1') {
          const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          const market = detectMarket(client.phone);

          let nudgeMsg;
          if (isHinglish(market)) {
            nudgeMsg = `Last reminder! Week ${weekNo} check-in miss mat karo. Progress track karna zaroori hai: ${checkinLink}`;
          } else {
            nudgeMsg = `Last reminder! Don't miss your Week ${weekNo} check-in. Tracking progress matters: ${checkinLink}`;
          }

          await sendRateLimited(client.phone, 'checkin_nudge_2', [String(weekNo), checkinLink], nudgeMsg);
        }
      }
    }

    return res.status(200).json({ success: true, nudged: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
