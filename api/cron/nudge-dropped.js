const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    // New leads with no reply in 2 hours → send trial nudge
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudgesSent = 0;

    for (const lead of (staleNew || [])) {
      // Check if we already sent a nudge
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (msgs?.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      nudgesSent++;
    }

    // Leads with no reply in 24 hours → mark as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleDrop } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of (staleDrop || [])) {
      // Check if they replied after creation
      const { data: inbound } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (inbound?.length > 0) continue;

      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads within 7-day window (one attempt only)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageable } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageable || [])) {
      const { data: reEngageMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_v1');

      if (reEngageMsgs?.length > 0) continue;

      await sendTemplate(lead.phone, 'reengage_v1', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      reEngaged++;
    }

    return res.json({ ok: true, nudgesSent, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
