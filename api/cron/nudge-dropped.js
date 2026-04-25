const db = require('../_lib/supabase');
const wa = require('../_lib/whatsapp');
const { verifyCronSecret, maskPhone, detectMarket, isHinglish } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const leads = await db.query(
      'leads',
      `status=eq.new&last_msg_at=gte.${fourteenDaysAgo}&last_msg_at=lte.${sevenDaysAgo}&select=*`
    );

    let nudged = 0;
    let errors = 0;

    for (const lead of leads) {
      try {
        const recentMsgs = await db.query(
          'messages',
          `phone=eq.${lead.phone}&direction=eq.out&template_name=eq.nudge_trial&select=id`
        );
        if (recentMsgs.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const trialUrl = 'https://fitnessbymaddy.com/shred.html';

        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! 🔥 Maddy ka $20 Zoom trial try karo — ek session mein samajh aa jayega ki coaching kaise kaam karta hai. Limited spots!\n${trialUrl}`
          : `Hey ${lead.name || 'there'}! 🔥 Try Maddy's $20 Zoom trial — one session to see how real coaching works. Limited spots!\n${trialUrl}`;

        try {
          await wa.sendTemplate(
            lead.phone,
            'nudge_trial',
            [lead.name || 'there', trialUrl],
            lead.name || 'there'
          );
          nudged++;
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
          errors++;
          continue;
        }

        await db.insert('messages', {
          phone: lead.phone,
          direction: 'out',
          body: msg,
          template_name: 'nudge_trial',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      } catch (err) {
        console.error(`Nudge error for lead ${lead.id}:`, err.message);
        errors++;
      }
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const staleLeads = await db.query(
      'leads',
      `status=eq.new&last_msg_at=lte.${twoDaysAgo}&select=id`
    );

    let autoDropped = 0;
    for (const lead of staleLeads) {
      const msgs = await db.query(
        'messages',
        `phone=eq.${lead.phone}&direction=eq.in&select=id&limit=1&order=sent_at.desc`
      );
      const outMsgs = await db.query(
        'messages',
        `phone=eq.${lead.phone}&direction=eq.out&select=id`
      );
      if (outMsgs.length >= 2 && msgs.length <= 1) {
        await db.update('leads', { id: lead.id }, { status: 'dropped' });
        autoDropped++;
      }
    }

    return res.status(200).json({
      ok: true,
      leads_found: leads.length,
      nudged,
      auto_dropped: autoDropped,
      errors,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
