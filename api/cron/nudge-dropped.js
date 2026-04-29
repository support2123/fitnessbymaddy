const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge' });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      try {
        const hinglish = isHinglishMarket(lead.market);

        const body = hinglish
          ? `Hey ${lead.name || ''}! Maddy ke team se — humne notice kiya aapne abhi join nahi kiya. Ek $20 trial session se start karo aur dekho results apne aap!\n\nhttps://fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || ''}! From Maddy's team — we noticed you haven't joined yet. Start with a $20 trial session and see the results for yourself!\n\nhttps://fitnessbymaddy.com/program-trial.html`;

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body,
          params: [lead.name || 'there']
        });

        if (result.sent) sent++;
      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo);

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: replyExists } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replyExists || replyExists.length === 0) {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          if (lead.created_at < oneDayAgo) {
            await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          } else {
            const hinglish = isHinglishMarket(lead.market);
            await sendWhatsApp({
              phone: lead.phone,
              templateName: 'nudge_trial',
              body: hinglish
                ? `Abhi bhi soch rahe ho? Sirf $20 mein ek trial Zoom session — risk free. Start karo!\n\nhttps://fitnessbymaddy.com/program-trial.html`
                : `Still thinking? Try a $20 trial Zoom session — risk free. Get started!\n\nhttps://fitnessbymaddy.com/program-trial.html`,
              params: [lead.name || 'there']
            });
          }
        }
      }
    }

    return res.status(200).json({ ok: true, nudged: sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
