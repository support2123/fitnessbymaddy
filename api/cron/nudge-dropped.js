const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Flow A step 3: Nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString());

    let nudgedCount = 0;
    let droppedCount = 0;
    let reengagedCount = 0;

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        const leadAge = now - new Date(lead.created_at);
        const hoursOld = leadAge / (1000 * 60 * 60);

        if (hoursOld >= 24) {
          // Flow A step 4: Mark as dropped after 24 hours
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          droppedCount++;
        } else if (hoursOld >= 2) {
          const market = lead.market || detectMarket(lead.phone);
          const isHinglish = market === 'IN';

          const msg = isHinglish
            ? `Hey! 👋 Maddy ka $20 Zoom trial try karo — full workout session + form check. Limited spots!\n\nhttps://fitnessbymaddy.com/program-trial.html`
            : `Hey! 👋 Try Maddy\'s $20 Zoom trial — full workout session + form check. Limited spots!\n\nhttps://fitnessbymaddy.com/program-trial.html`;

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            body: msg,
            params: [lead.name || 'there']
          });
          nudgedCount++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule: one re-engage attempt after 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', eightDaysAgo.toISOString());

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: outbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (outbound && outbound.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const isHinglish = market === 'IN';

        const msg = isHinglish
          ? `Hi ${lead.name || 'there'}! 🙏 Maddy yahan — agar abhi bhi fitness goals pe kaam karna chahte ho, toh reply kar do. New programs available hain!`
          : `Hi ${lead.name || 'there'}! 🙏 Maddy here — if you're still working towards your fitness goals, just reply. We have new programs available!`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          body: msg,
          params: [lead.name || 'there']
        });
        reengagedCount++;
      }
    }

    return res.status(200).json({
      nudged: nudgedCount,
      dropped: droppedCount,
      reengaged: reengagedCount
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
