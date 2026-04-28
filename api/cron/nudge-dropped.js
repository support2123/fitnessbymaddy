const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-vercel-cron'];
  const authHeader = req.headers.authorization;
  const isAuthorized = cronSecret || (authHeader && authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNoReply } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 48) {
          const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
          const template = hinglish ? 'nudge_trial' : 'nudge_trial_en';
          await sendTemplate(lead.phone, template, [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]);
          nudged++;
        } else if (hoursSinceLastMsg >= 48) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    const reEngageCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const reEngageMax = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', reEngageCutoff)
      .gte('last_msg_at', reEngageMax);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer')
          .limit(1);

        if (!recentMsg || recentMsg.length === 0) {
          const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
          const template = hinglish ? 'reengage_offer' : 'reengage_offer_en';
          await sendTemplate(lead.phone, template, [lead.name || 'there']);
          reEngaged++;
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
