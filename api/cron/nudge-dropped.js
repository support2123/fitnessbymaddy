const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

const NUDGE_WINDOW_DAYS = 7;
const COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const windowStart = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', cooldownCutoff)
      .lte('last_msg_at', windowStart);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentMessages && recentMessages.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? [lead.name || 'there', '$20 trial se start karo — no commitment!']
        : [lead.name || 'there', 'Start with a $20 trial — no commitment needed!'];

      const result = await sendTemplate(lead.phone, 'reengagement_trial', params);
      if (result.ok) nudged++;
    }

    return res.status(200).json({ ok: true, nudged, checked: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
