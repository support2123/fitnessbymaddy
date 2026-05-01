const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.json({ ok: true, message: 'No leads to nudge', nudged: 0 });
  }

  let nudged = 0;

  for (const lead of leads) {
    const allowed = await canSendMessage(lead.phone);
    if (!allowed) continue;

    const template = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial';
    const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

    await sendTemplate(lead.phone, template, [
      lead.name || 'there',
      trialUrl,
    ]);
    nudged++;
  }

  return res.json({ ok: true, nudged, total_eligible: leads.length });
};
