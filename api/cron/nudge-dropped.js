const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage, canSendMessage } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();
  const now = new Date();

  // Nudge new leads who haven't replied in 2 hours
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;

  for (const lead of staleNewLeads || []) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (msgs && msgs.length > 0) continue;

    const allowed = await canSendMessage(lead.phone);
    if (!allowed) continue;

    await sendTemplate(lead.phone, 'nudge_trial', [
      lead.name || 'there',
      'https://www.fitnessbymaddy.com/program-trial.html',
    ]);
    await logMessage(lead.phone, 'out', 'Nudge: trial offer', 'nudge_trial');
    nudged++;
  }

  // Drop leads with no reply after 24 hours
  const { data: expiredLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of expiredLeads || []) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (msgs && msgs.length > 0) continue;

    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('id', lead.id);
    dropped++;
  }

  // Re-engage dropped leads (7-day rule — only if dropped 7+ days ago, nudge once)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', eightDaysAgo);

  let reEngaged = 0;
  for (const lead of reEngageLeads || []) {
    const allowed = await canSendMessage(lead.phone);
    if (!allowed) continue;

    await sendTemplate(lead.phone, 'reengage_7day', [
      lead.name || 'there',
    ]);
    await logMessage(lead.phone, 'out', 'Re-engage at 7 days', 'reengage_7day');
    reEngaged++;
  }

  return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
};
