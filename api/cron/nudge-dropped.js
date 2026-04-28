const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.json({ message: 'No leads to nudge', ...results });
    }

    for (const lead of newLeads) {
      try {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) {
          results.skipped++;
          continue;
        }

        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count && count >= 2) {
          results.skipped++;
          continue;
        }

        const trialUrl = 'https://fitnessbymaddy.com/shred.html';
        const hinglish = isHinglish(lead.market);

        const msg = hinglish
          ? [`Hey! Maddy ka $20 trial try karna chahoge? Ek Zoom session mein samajh aa jayega ki aapko kya chahiye: ${trialUrl}`]
          : [`Hey! Want to try Maddy's $20 trial? One Zoom session to understand exactly what you need: ${trialUrl}`];

        await sendTemplate(lead.phone, 'nudge_trial', msg);
        results.nudged++;

      } catch (leadErr) {
        console.error('Nudge error:', leadErr.message);
        results.errors++;
      }
    }

    return res.json({ message: 'Nudge cron complete', ...results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
