const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/mask-phone');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of newLeads || []) {
      const lastMsg = new Date(lead.last_msg_at);
      const hoursSinceLastMsg = (now - lastMsg) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 48) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        console.log(`Dropped: ${maskPhone(lead.phone)}`);
        continue;
      }

      if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
        const hinglish = isHinglish(lead.market);
        const template = hinglish ? 'nudge_trial' : 'nudge_trial_en';

        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
        ]);

        nudged++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      }
    }

    const { data: staleDropped } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString());

    let reEngaged = 0;

    for (const lead of staleDropped || []) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      await sendTemplate(lead.phone, hinglish ? 'win_back' : 'win_back_en', [
        lead.name || 'there',
      ]);

      reEngaged++;
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      dropped,
      re_engaged: reEngaged,
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
