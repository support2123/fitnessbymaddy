const { getClient } = require('../_lib/supabase');
const { sendText, canSendToLead } = require('../_lib/whatsapp');
const { maskPhone, isHinglishMarket } = require('../_lib/helpers');

const TRIAL_URL = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial';
const MAX_PER_RUN = 50;

module.exports = async function handler(req, res) {
  /* ── Verify Vercel Cron auth ── */
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sent = 0;

  try {
    const db = getClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    /* ── 1. Fetch dropped leads created 7-30 days ago ── */
    const { data: leads, error } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', thirtyDaysAgo)
      .lte('created_at', sevenDaysAgo)
      .limit(MAX_PER_RUN);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'No eligible leads' });
    }

    for (const lead of leads) {
      try {
        /* ── 2. Check no outbound message in the last 7 days ── */
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMessages && recentMessages.length > 0) continue;

        /* ── 3. Check rate limit ── */
        const allowed = await canSendToLead(lead.phone);
        if (!allowed) continue;

        /* ── 4. Build message based on market ── */
        const name = lead.name || 'there';
        let msg;

        if (isHinglishMarket(lead.phone)) {
          msg =
            `Hi ${name}! \u{1F44B} Maddy's team se. Abhi bhi fitness goals pe kaam karna chahte ho? ` +
            `Humare $20 trial zoom session try karo — no commitment!\n\n${TRIAL_URL}`;
        } else {
          msg =
            `Hi ${name}! \u{1F44B} Still thinking about your fitness goals? ` +
            `Try our $20 trial Zoom session — zero commitment, full guidance!\n\n${TRIAL_URL}`;
        }

        /* ── 5. Send message ── */
        await sendText(lead.phone, msg);
        sent++;
      } catch (leadErr) {
        console.error(
          `[nudge-dropped] Error for lead ${maskPhone(lead.phone || '')}: ${leadErr.message}`
        );
        /* Continue processing remaining leads */
      }
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error(`[nudge-dropped] Fatal error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
