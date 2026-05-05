const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, checkRateLimit } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  let nudged = 0;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', threeDaysAgo);

    if (!droppedLeads?.length) {
      return res.json({ ok: true, nudged: 0 });
    }

    for (const lead of droppedLeads) {
      const canSend = await checkRateLimit(lead.phone);
      if (!canSend) continue;

      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_reengagement');

      if ((count || 0) >= 1) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'nudge_reengagement_hi' : 'nudge_reengagement';

      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      nudged++;
    }

    return res.json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
