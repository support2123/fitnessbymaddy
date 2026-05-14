const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo.toISOString())
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0, dropped: 0 });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of newLeads) {
      const hoursSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24 * 7) {
        continue;
      }

      const hoursSinceLastMsg = lead.last_msg_at
        ? (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60)
        : hoursSinceCreated;

      if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 48) {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        continue;
      }

      if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
        const market = detectMarket(lead.phone);
        const isHinglish = market === 'IN';

        const msg = isHinglish
          ? `Hey! Maddy ka $20 trial try karna chahoge? Ek Zoom session mein pata chalega ki coaching kaise kaam karta hai. Interested?`
          : `Hey! Want to try Maddy's $20 trial? One Zoom session to see how coaching works. Interested?`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: [lead.name || 'there']
        });

        nudged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cycle complete',
      total_leads: newLeads.length,
      nudged,
      dropped
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
