const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getClient();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    const nudged = [];

    if (newLeads) {
      for (const lead of newLeads) {
        const lastMsgAt = new Date(lead.last_msg_at || lead.created_at);
        const hoursSince = (now - lastMsgAt) / (1000 * 60 * 60);

        if (hoursSince >= 24) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          continue;
        }

        if (hoursSince >= 2) {
          const templateName = isHinglish(lead.market)
            ? 'nudge_trial'
            : 'nudge_trial_en';

          await sendTemplate(lead.phone, templateName, [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ]);
          nudged.push(lead.id);
        }
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lt('last_msg_at', oneDayAgo);

    const reengaged = [];

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer');

        if ((count || 0) > 0) continue;

        const templateName = isHinglish(lead.market)
          ? 'reengage_offer'
          : 'reengage_offer_en';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
        ]);
        reengaged.push(lead.id);
      }
    }

    return res.json({
      success: true,
      nudged: nudged.length,
      reengaged: reengaged.length,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
