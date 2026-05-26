const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { maskPhone } = require('../../lib/masking');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - (REENGAGEMENT_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'ok', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo.toISOString())
        .limit(1);

      if (recentMessages && recentMessages.length > 0) continue;

      const msg = isHinglish(lead.market)
        ? `Hey! 👋 Maddy's team se — abhi bhi interest hai fitness goals mein? Humara $20 trial session perfect starting point hai.\n\nBook karo: https://fitnessbymaddy.com/intake.html\n\nReply "STOP" agar nahi chahiye.`
        : `Hey! 👋 Still thinking about your fitness goals? Our $20 trial session is the perfect way to get started with Maddy.\n\nBook here: https://fitnessbymaddy.com/intake.html\n\nReply "STOP" to opt out.`;

      await sendWhatsApp(lead.phone, msg, 'nudge_reengagement');
      nudged++;
    }

    console.log(`Nudge cron: nudged=${nudged} dropped leads`);
    return res.status(200).json({ status: 'ok', nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
