const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNeedingNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    if (newLeadsNeedingNudge) {
      for (const lead of newLeadsNeedingNudge) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
          const hinglish = isHinglish(lead.market);
          const body = hinglish
            ? `Hey! Maddy ka $20 trial session try karna chahoge? Ek Zoom call mein full guidance milegi. Link:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
            : `Hey! Want to try Maddy's $20 trial session? Get full guidance in one Zoom call. Link:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            body,
            params: [lead.name || 'there']
          });
          nudged++;
        }

        if (hoursSinceLastMsg >= 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceCreated >= 3 && daysSinceCreated < 4) {
          const { data: recentOut } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .eq('template_name', 'reengage_dropped')
            .limit(1);

          if (!recentOut || recentOut.length === 0) {
            const hinglish = isHinglish(lead.market);
            const body = hinglish
              ? `Hi! Maddy ki team se ek last message. Abhi bhi fitness goals pe kaam karna hai? Ye week limited offer hai — reply karo "YES" agar interested ho!`
              : `Hi! One last message from Maddy's team. Still thinking about your fitness goals? This week we have a limited offer — reply "YES" if you're interested!`;

            await sendWhatsApp({
              phone: lead.phone,
              templateName: 'reengage_dropped',
              body,
              params: [lead.name || 'there']
            });
            reengaged++;
          }
        }
      }
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      reengaged,
      dropped: newLeadsNeedingNudge?.filter(l => {
        const hrs = (Date.now() - new Date(l.last_msg_at).getTime()) / (1000 * 60 * 60);
        return hrs >= 24;
      }).length || 0
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
