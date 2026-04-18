const { getClient } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const market = lead.market || detectMarket(lead.phone);

      const msg =
        market === 'IN'
          ? `Hey ${lead.name || 'there'}! 👋 Abhi bhi sooch rahe ho? Maddy ka $20 trial session try karo — full workout + nutrition guidance ek Zoom call mein.\n\n👉 Book karo: ${SITE}/program-trial.html\n\nKoi sawal ho toh pooch lo!`
          : `Hey ${lead.name || 'there'}! 👋 Still thinking? Try Maddy's $20 trial session — a full workout + nutrition guidance on one Zoom call.\n\n👉 Book here: ${SITE}/program-trial.html\n\nAny questions? Just ask!`;

      await sendText(lead.phone, msg);

      await db
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      nudged++;
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
