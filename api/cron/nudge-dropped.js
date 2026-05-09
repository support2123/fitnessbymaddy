const { getClient } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).end();
    }
  }

  const db = getClient();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    const { data: recentMessages } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_7d')
      .gte('sent_at', sevenDaysAgo);

    const alreadyNudged = new Set((recentMessages || []).map(m => m.phone));
    let sent = 0;

    for (const lead of droppedLeads) {
      if (alreadyNudged.has(lead.phone)) continue;

      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));

      const msg = hinglish
        ? `Hey ${lead.name || ''}! Maddy ki team se. Abhi bhi fitness goals pe kaam karna hai? Ek $20 trial session se start karo — no commitment:\nhttps://fitnessbymaddy.com/intake?program=zoom_trial\n\nReply STOP to opt out.`
        : `Hey ${lead.name || ''}! Still thinking about your fitness goals? Start with a $20 trial session — no commitment:\nhttps://fitnessbymaddy.com/intake?program=zoom_trial\n\nReply STOP to opt out.`;

      await sendWhatsApp(lead.phone, msg, 'reengagement_7d', false);
      sent++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .is('program_interest', null);

    let nudged = 0;
    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const { data: outbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1)
          .maybeSingle();

        if (outbound) continue;

        const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
        const msg = hinglish
          ? `Hey! Ek $20 Zoom trial session try karo Maddy ke saath. No commitment — dekho apne liye fit hai ya nahi:\nhttps://fitnessbymaddy.com/intake?program=zoom_trial`
          : `Hey! Try a $20 Zoom trial session with Maddy. No commitment — just see if it's a fit:\nhttps://fitnessbymaddy.com/intake?program=zoom_trial`;

        await sendWhatsApp(lead.phone, msg, 'nudge_trial', false);
        nudged++;
      }
    }

    return res.status(200).json({ reengaged: sent, nudged, total: (droppedLeads || []).length });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
