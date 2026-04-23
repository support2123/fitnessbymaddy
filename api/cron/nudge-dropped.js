const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeable } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    if (!nudgeable || nudgeable.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of nudgeable) {
      const hinglish = isHinglish(lead.market);
      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

      const msgBody = hinglish
        ? 'Hey! Ek chhota sa step le lo — $20 trial se start karo aur dekho Maddy ka method kaise kaam karta hai. No pressure!'
        : "Hey! Take a small step — start with a $20 trial and see how Maddy's method works. No pressure!";

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: [msgBody, trialUrl],
      });

      nudged++;
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
