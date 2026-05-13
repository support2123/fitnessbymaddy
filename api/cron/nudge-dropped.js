const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const { data: newLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('created_at', sevenDaysAgo);

  let nudged = 0;

  if (newLeads) {
    for (const lead of newLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if ((count || 0) >= 2) continue;

      const hinglish = isHinglish(lead.market || 'GLOBAL');
      await sendWhatsApp({
        phone: lead.phone,
        templateName: hinglish ? 'nudge_trial_hi' : 'nudge_trial_en',
        params: [lead.name || 'there']
      });
      nudged++;
    }
  }

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: staleLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('last_msg_at', oneDayAgo);

  let dropped = 0;
  if (staleLeads) {
    for (const lead of staleLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', oneDayAgo);

      if (!count) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }
  }

  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('created_at', sevenDaysAgo)
    .lt('created_at', fourteenDaysAgo);

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_offer');

      if ((count || 0) >= 1) continue;

      const hinglish = isHinglish(lead.market || 'GLOBAL');
      await sendWhatsApp({
        phone: lead.phone,
        templateName: hinglish ? 'reengage_offer_hi' : 'reengage_offer_en',
        params: [lead.name || 'there']
      });
      reEngaged++;
    }
  }

  console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${reEngaged} re-engaged`);
  return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
};
