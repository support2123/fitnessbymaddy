const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const { data: newLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  let nudged = 0;
  let dropped = 0;

  for (const lead of (newLeads || [])) {
    const hoursSinceCreated = (now - new Date(lead.created_at)) / (1000 * 60 * 60);

    if (hoursSinceCreated >= 24) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
      continue;
    }

    if (hoursSinceCreated >= 2) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? [lead.name || 'there', 'https://www.fitnessbymaddy.com/shred.html']
        : [lead.name || 'there', 'https://www.fitnessbymaddy.com/shred.html'];

      const result = await sendWhatsApp(lead.phone, 'nudge_trial', params);
      if (result.ok) nudged++;
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', fourteenDaysAgo);

  let reEngaged = 0;

  for (const lead of (reEngageLeads || [])) {
    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    const params = hinglish
      ? [lead.name || 'there']
      : [lead.name || 'there'];

    const result = await sendWhatsApp(lead.phone, 'reengage_7day', params);
    if (result.ok) reEngaged++;
  }

  return res.status(200).json({ nudged, dropped, reEngaged });
};
