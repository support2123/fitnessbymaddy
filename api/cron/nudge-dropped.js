const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const { data: staleLeads } = await db.from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoDaysAgo.toISOString())
    .gte('created_at', sevenDaysAgo.toISOString());

  let nudged = 0;

  for (const lead of (staleLeads || [])) {
    const { data: recentMessages } = await db.from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (recentMessages && recentMessages.length > 0) continue;

    await sendTemplate(lead.phone, 'nudge_trial', [
      lead.name || 'there'
    ]);
    nudged++;
  }

  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  const { data: deadLeads } = await db.from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo.toISOString())
    .lt('created_at', sevenDaysAgo.toISOString());

  let dropped = 0;
  for (const lead of (deadLeads || [])) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    dropped++;
  }

  return res.status(200).json({ ok: true, nudged, dropped });
};
