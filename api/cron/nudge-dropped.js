const { getSupabase } = require('../../lib/supabase');
const { rateLimitedSend } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Re-engage leads dropped 3-7 days ago (not older, respect the 7-day rule)
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', threeDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', threeDaysAgo)
        .limit(1);

      if (recentMsg?.length) continue;

      const hinglish = isHinglish(lead.market);
      const trialUrl = `${SITE}/shred.html`;

      const params = hinglish
        ? [lead.name || 'there', '$20', trialUrl]
        : [lead.name || 'there', '$20', trialUrl];

      const result = await rateLimitedSend(lead.phone, 'win_back_trial', params);
      if (result.ok) sent++;
    }

    // Also nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000).toISOString();

    const { data: silentLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudgedNew = 0;

    for (const lead of silentLeads || []) {
      const { data: outMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', twoHoursAgo)
        .limit(1);

      if (outMessages?.length) continue;

      const { data: inMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      if (inMessages?.length > 1) continue;

      const result = await rateLimitedSend(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        '$20',
        `${SITE}/shred.html`
      ]);

      if (result.ok) nudgedNew++;
    }

    // Mark leads older than 24hrs with no reply as dropped
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of staleLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at || twentyFourHoursAgo)
        .limit(2);

      if (!replies || replies.length <= 1) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    console.log(`Nudge cron: sent=${sent}, nudgedNew=${nudgedNew}, dropped=${dropped}`);

    return res.status(200).json({ ok: true, sent, nudgedNew, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
