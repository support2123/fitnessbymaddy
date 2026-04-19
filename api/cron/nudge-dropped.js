const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo);

    let newDropped = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          newDropped++;
        } else if (hoursSinceMsg >= 2) {
          const market = lead.market || 'GLOBAL';
          const templateName = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';
          await sendTemplate(lead.phone, templateName, [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial'
          ]);
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', thirtyDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer');

        if (count > 0) continue;

        const market = lead.market || 'GLOBAL';
        const templateName = isHinglish(market) ? 'reengage_offer' : 'reengage_offer_en';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        reEngaged++;
      }
    }

    return res.status(200).json({
      action: 'nudge_complete',
      new_dropped: newDropped,
      re_engaged: reEngaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
