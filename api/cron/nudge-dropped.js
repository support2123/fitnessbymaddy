const { getClient } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getClient();
  const now = new Date();

  // Find leads that went silent 2+ hours ago (for nudge) and new leads from today
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Nudge new leads who haven't replied in 2 hours
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;
  let reengaged = 0;

  for (const lead of staleNewLeads || []) {
    const allowed = await canSendToLead(lead.phone);
    if (!allowed) continue;

    const hinglish = isHinglish(lead.market);

    await sendTemplate(lead.phone, 'nudge_trial', [
      lead.name || 'there',
      hinglish
        ? 'Ek baar try karo — sirf $20 ka Zoom trial session!'
        : 'Give it a try — just $20 for a Zoom trial session!',
      'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    ]);
    nudged++;
    console.log(`[NUDGE] ${maskPhone(lead.phone)} — trial nudge sent`);
  }

  // Drop leads with no reply in 24 hours
  const { data: deadLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  for (const lead of deadLeads || []) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    dropped++;
  }

  // Re-engage dropped leads after 7 days (one-time)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('created_at', new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());

  for (const lead of droppedLeads || []) {
    // Check if we've already re-engaged (look for reengage template in messages)
    const { data: prevReengage } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (prevReengage && prevReengage.length > 0) continue;

    const allowed = await canSendToLead(lead.phone);
    if (!allowed) continue;

    const hinglish = isHinglish(lead.market);
    await sendTemplate(lead.phone, 'reengage_7day', [
      lead.name || 'there',
      hinglish
        ? 'Maddy ke saath abhi bhi start kar sakte ho! Limited slots available.'
        : "You can still start with Maddy! Limited spots available.",
    ]);
    reengaged++;
  }

  console.log(`[NUDGE-CRON] nudged=${nudged} dropped=${dropped} reengaged=${reengaged}`);

  return res.status(200).json({
    success: true,
    nudged,
    dropped,
    reengaged,
  });
};
