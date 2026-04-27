const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getSupabase();

  try {
    // Find leads that went quiet (new status, last msg > 2 hrs ago, < 7 days old)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleLeads || []) {
      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 24) {
        // Drop after 24 hours of silence
        await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        console.log(`[NUDGE] Dropped: ${maskPhone(lead.phone)}`);
        continue;
      }

      // Nudge if between 2-24 hours and rate limit allows
      if (await canSendToLead(lead.phone)) {
        const hinglish = isHinglish(lead.market);

        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            hinglish
              ? 'Sirf $20 mein Zoom trial try karo — no commitment!'
              : 'Try a $20 Zoom trial — no commitment!',
          ],
        });

        nudged++;
        console.log(`[NUDGE] Sent to: ${maskPhone(lead.phone)}`);
      }
    }

    // Re-engage dropped leads (7-day rule: try once more after 7 days)
    const sevenDaysExact = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysExact.toISOString())
      .gt('last_msg_at', eightDaysAgo.toISOString());

    let reengaged = 0;

    for (const lead of reengageLeads || []) {
      if (await canSendToLead(lead.phone)) {
        const hinglish = isHinglish(lead.market);

        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            hinglish
              ? 'Maddy ka naya batch start ho raha hai — last chance to join!'
              : "Maddy's new batch is starting — last chance to join!",
          ],
        });

        reengaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error(`[NUDGE-CRON] Error: ${err.message}`);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
