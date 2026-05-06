const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge new leads who haven't replied after 2 hours
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stalledLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;

  for (const lead of (stalledLeads || [])) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (replies && replies.length > 0) continue;

    const { data: nudges } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (!nudges || nudges.length === 0) {
      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });
      nudged++;
    }
  }

  // Drop leads with no reply after 24 hours
  const { data: deadLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo)
    .gt('created_at', sevenDaysAgo);

  for (const lead of (deadLeads || [])) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (replies && replies.length > 0) continue;

    await db.from('leads')
      .update({ status: 'dropped' })
      .eq('id', lead.id);
    dropped++;
  }

  // Re-engage dropped leads after 7 days (one-time)
  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo);

  let reEngaged = 0;
  for (const lead of (reEngageLeads || [])) {
    const { data: reEngageMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (reEngageMsg && reEngageMsg.length > 0) continue;

    await sendWhatsApp(lead.phone, 'reengage_7day', {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there']
    });
    reEngaged++;
  }

  return res.status(200).json({ nudged, dropped, reEngaged });
};
