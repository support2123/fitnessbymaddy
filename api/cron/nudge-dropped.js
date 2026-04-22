const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!nudgeLeads || nudgeLeads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    let sent = 0;
    let rateLimited = 0;

    for (const lead of nudgeLeads) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) {
        rateLimited++;
        continue;
      }

      const market = detectMarket(lead.phone);
      const msg = market === 'IN'
        ? `Hey ${lead.name || ''}! Maddy ka $20 Zoom trial abhi bhi available hai \u{1F4AA}\n\n1 session mein dekhlo coaching kaisi hogi. Interested ho?\n\nhttps://fitnessbymaddy.com/shred.html`
        : `Hey ${lead.name || ''}! Maddy's $20 Zoom trial is still available \u{1F4AA}\n\nOne session to experience the coaching. Interested?\n\nhttps://fitnessbymaddy.com/shred.html`;

      await sendWhatsApp({ phone: lead.phone, message: msg, templateName: 'nudge_trial' });
      sent++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    if (noReplyLeads) {
      for (const lead of noReplyLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (!msgs || msgs.length === 0) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    return res.status(200).json({ status: 'ok', sent, rateLimited, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
