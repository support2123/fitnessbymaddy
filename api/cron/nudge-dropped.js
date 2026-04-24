const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Re-engage leads that were dropped 7-14 days ago (one-time nudge)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!droppedLeads || droppedLeads.length === 0) {
    return json(res, 200, { ok: true, nudged: 0 });
  }

  // Check which dropped leads have already been nudged
  let nudged = 0;

  for (const lead of droppedLeads) {
    const { data: priorNudges } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengagement_v1')
      .limit(1);

    if (priorNudges && priorNudges.length > 0) continue;

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    const msg = hinglish
      ? ['Hey! Maddy ka $20 trial session abhi bhi available hai. Ek baar try karke dekho — koi commitment nahi. Book karo: https://fitnessbymaddy.com/shred.html']
      : ['Hey! Maddy\'s $20 trial session is still available. Try it once — no commitment. Book here: https://fitnessbymaddy.com/shred.html'];

    await sendTemplate(lead.phone, 'reengagement_v1', msg);
    nudged++;
  }

  return json(res, 200, { ok: true, nudged, total_dropped: droppedLeads.length });
};
