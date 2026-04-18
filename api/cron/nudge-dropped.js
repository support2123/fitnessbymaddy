const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, isHinglish, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: noReplyLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudgedCount = 0;

    if (noReplyLeads) {
      for (const lead of noReplyLeads) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          continue;
        }

        if (hoursSinceMsg >= 2 && hoursSinceMsg < 6) {
          const market = detectMarket(lead.phone);
          const hinglish = isHinglish(market);

          const params = hinglish
            ? ['https://fitnessbymaddy.com/program-trial.html']
            : ['https://fitnessbymaddy.com/program-trial.html'];

          await sendWhatsApp(lead.phone, 'nudge_trial', params);
          nudgedCount++;
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', thirtyDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngagedCount = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengagement')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (recentMsg) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const params = hinglish
          ? [lead.name || 'there']
          : [lead.name || 'there'];

        await sendWhatsApp(lead.phone, 'reengagement', params);
        reEngagedCount++;
      }
    }

    return res.status(200).json({
      nudged: nudgedCount,
      reengaged: reEngagedCount
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
