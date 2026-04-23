const { getClient } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getClient();

    // Re-engage leads dropped 7+ days ago who haven't been nudged recently
    // Only nudge once — leads dropped more than 14 days ago are left alone
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      // Check we haven't sent a re-engage message already
      const { data: recentOut } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const firstName = (lead.name || 'there').split(' ')[0];

      const msg = hinglish
        ? `Hey ${firstName}! 👋 Maddy ki team se.\n\nAbhi bhi fitness goals ke baare mein soch rahe ho? Humare $20 trial session try karo — zero risk, full experience.\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/trial\n\nBas ek step door ho results se! 💪`
        : `Hey ${firstName}! 👋 It's Maddy's team.\n\nStill thinking about your fitness goals? Try our $20 trial session — zero risk, full experience.\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/trial\n\nYou're just one step away from results! 💪`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        body: msg
      });

      if (result.sent) sent++;
    }

    return res.json({ message: 'Nudge complete', sent, total: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
