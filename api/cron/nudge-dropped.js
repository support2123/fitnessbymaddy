const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeads || [])) {
      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at || lead.created_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 24 * 7) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        continue;
      }

      if (!(await canSendToLead(lead.phone))) continue;

      const market = lead.market || detectMarket(lead.phone);

      if (hoursSinceLastMsg >= 24) {
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
        }
        nudged++;
      } else if (hoursSinceLastMsg >= 2) {
        if (isHinglish(market)) {
          await sendTemplate(lead.phone, 'nudge_reply', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'nudge_reply_en', [lead.name || 'there']);
        }
        nudged++;
      }
    }

    const { data: checkinNudges } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;

    for (const client of (checkinNudges || [])) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .single();

      if (checkin) continue;

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMsg) {
        const hoursSinceNudge = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (1000 * 60 * 60);
        if (hoursSinceNudge < 24) continue;
      }

      const market = detectMarket(client.phone);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksElapsed}`;

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'checkin_reminder_en', [
          client.name || 'there',
          checkinUrl
        ]);
      }
      checkinNudged++;
    }

    return res.status(200).json({ nudged, dropped, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
