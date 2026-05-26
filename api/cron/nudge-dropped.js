const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglishMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const eightDaysAgo = new Date(
    Date.now() - 8 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: leads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gte('last_msg_at', eightDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  let nudged = 0;

  if (leads) {
    for (const lead of leads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (count && count > 0) continue;

      const hinglish = isHinglishMarket(lead.market);
      const msg = hinglish
        ? [
            'Hey! Maddy ka $20 trial session abhi available hai — ek baar try karke dekho, results khud dikhenge.',
          ]
        : [
            "Hey! Maddy's $20 trial session is still available — try it once and see the results for yourself.",
          ];

      await sendWhatsApp(lead.phone, 'nudge_trial', msg);
      nudged++;
    }
  }

  const twoHoursAgo = new Date(
    Date.now() - 2 * 60 * 60 * 1000
  ).toISOString();
  const threeHoursAgo = new Date(
    Date.now() - 3 * 60 * 60 * 1000
  ).toISOString();

  const { data: freshLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gte('created_at', threeHoursAgo)
    .lte('created_at', twoHoursAgo);

  let nudgedFresh = 0;

  if (freshLeads) {
    for (const lead of freshLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (count && count > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        "Still thinking? Try Maddy's $20 trial session — zero risk, real results.",
      ]);
      nudgedFresh++;
    }
  }

  const oneDayAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  await db
    .from('leads')
    .update({ status: 'dropped' })
    .eq('status', 'new')
    .lte('last_msg_at', oneDayAgo);

  return res.status(200).json({
    action: 'nudge_complete',
    nudged_7day: nudged,
    nudged_2hr: nudgedFresh,
  });
};
