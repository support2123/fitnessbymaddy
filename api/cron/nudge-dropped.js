const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const hoursSinceCreated =
          (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceCreated >= 2) {
          const market = detectMarket(lead.phone);
          const hinglish = isHinglish(market);

          const params = hinglish
            ? ['Hey! Maddy ke $20 Zoom trial mein full workout + diet guidance milta hai. Try karo!']
            : ['Hey! Try Maddy\'s $20 Zoom trial — full workout + diet guidance in one session!'];

          await sendWhatsApp(lead.phone, 'nudge_trial', params);
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const params = hinglish
          ? [lead.name || 'there']
          : [lead.name || 'there'];

        await sendWhatsApp(lead.phone, 'reengage_v1', params);
        reEngaged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      dropped,
      re_engaged: reEngaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
