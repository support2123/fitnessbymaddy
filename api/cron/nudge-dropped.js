const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ action: 'no_leads_to_nudge' });
  }

  const { data: alreadyNudged } = await db
    .from('messages')
    .select('phone')
    .eq('template_name', 'reengagement_7d')
    .gte('sent_at', fourteenDaysAgo);

  const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

  let sent = 0;
  for (const lead of droppedLeads) {
    if (nudgedPhones.has(lead.phone)) continue;

    await sendWhatsApp(lead.phone, 'reengagement_7d', [
      lead.name || 'there',
    ]);
    sent++;
  }

  return res.status(200).json({ action: 'nudge_sent', count: sent });
};
