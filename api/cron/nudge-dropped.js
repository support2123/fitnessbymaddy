import supabase from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket } from '../../lib/market.js';

const REENGAGEMENT_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_DAYS = 7;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    const results = [];

    for (const lead of leads) {
      const cooldownDate = new Date(Date.now() - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', cooldownDate)
        .limit(1);

      if (recentMsgs && recentMsgs.length > 0) continue;

      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
      const siteBase = process.env.SITE_URL || 'https://fitnessbymaddy.com';

      const msg = hinglish
        ? `Hey! Maddy ka $20 trial abhi bhi available hai \u2014 7 din mein results dikhte hain. Try karo: ${siteBase}/shred.html`
        : `Hey! Maddy's $20 trial is still available \u2014 see results in just 7 days. Try it here: ${siteBase}/shred.html`;

      const result = await sendWhatsApp(lead.phone, msg, null, true);
      results.push({ lead_id: lead.id, sent: result.ok !== false });
    }

    return res.status(200).json({ nudged: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
