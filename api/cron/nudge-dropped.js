const { getSupabase } = require('../../lib/supabase');
const { isHinglish, detectMarket } = require('../../lib/helpers');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads } = await db
    .from('leads')
    .select('*')
    .in('status', ['new', 'qualified'])
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.json({ ok: true, nudged: 0 });
  }

  let nudged = 0;

  for (const lead of leads) {
    const { data: recentMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .gte('sent_at', sevenDaysAgo)
      .limit(1);

    if (recentMsg && recentMsg.length > 0) continue;

    const market = lead.market || detectMarket(lead.phone);

    const params = isHinglish(market)
      ? ['Hey! Kya aapne trial check kiya? Sirf $20 mein Maddy ke saath ek Zoom session. Link: https://fitnessbymaddy.com/shred.html']
      : ['Hey! Have you checked out the trial? Just $20 for a Zoom session with Maddy. Link: https://fitnessbymaddy.com/shred.html'];

    await sendTemplate(lead.phone, 'nudge_trial', params);
    nudged++;
  }

  return res.json({ ok: true, nudged });
};
