const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');
const { detectMarket, isHinglish } = require('../../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 2 * SEVEN_DAYS_MS).toISOString();

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ ok: true, nudged: 0 });
  }

  let nudged = 0;

  for (const lead of droppedLeads) {
    const { data: recentMsg } = await supabase
      .from('messages')
      .select('sent_at')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_reengagement')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (recentMsg) continue;

    const market = lead.market || detectMarket(lead.phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? 'nudge_reengagement_hi' : 'nudge_reengagement_en';

    await sendTemplate(lead.phone, templateName, [
      lead.name || 'there',
    ]);
    await logMessage(
      lead.phone, 'out',
      `[template:${templateName}] re-engagement nudge`,
      'nudge_reengagement'
    );
    nudged++;
  }

  return res.status(200).json({ ok: true, nudged });
};
