const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: newLeadsNeedNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', twentyFourHoursAgo.toISOString());

    let nudgedCount = 0;
    let droppedCount = 0;

    if (newLeadsNeedNudge) {
      for (const lead of newLeadsNeedNudge) {
        const hinglish = isHinglish(lead.market);
        const templateName = hinglish ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/shred.html'
        ]);
        nudgedCount++;
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo.toISOString());

    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        droppedCount++;
      }
    }

    const { data: droppedForReengagement } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    let reengagedCount = 0;

    if (droppedForReengagement) {
      for (const lead of droppedForReengagement) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (recentMsg) {
          const lastSent = new Date(recentMsg.sent_at);
          const daysSinceLastMsg = (now - lastSent) / (1000 * 60 * 60 * 24);
          if (daysSinceLastMsg < 7) continue;
        }

        const hinglish = isHinglish(lead.market);
        const templateName = hinglish ? 'reengage_dropped' : 'reengage_dropped_en';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        reengagedCount++;
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('status', 'active');

    let checkinNudgeCount = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayInWeek = daysSinceStart % 7;
        if (dayInWeek >= 1 && dayInWeek <= 2) {
          const hinglish = isHinglish(client.leads?.market || 'GLOBAL');
          const templateName = hinglish ? 'checkin_reminder' : 'checkin_reminder_en';
          const link = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, templateName, [
            client.name || 'there',
            link
          ]);
          checkinNudgeCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged: nudgedCount,
      dropped: droppedCount,
      reengaged: reengagedCount,
      checkin_nudges: checkinNudgeCount
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
