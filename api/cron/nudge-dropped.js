const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
    return res.status(200).json({ ok: true, nudged: 0 });
  }

  const { data: alreadyNudged } = await db
    .from('messages')
    .select('phone')
    .eq('direction', 'out')
    .eq('template_name', 'reengagement_v1')
    .gte('sent_at', sevenDaysAgo);

  const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));
  let nudged = 0;

  for (const lead of droppedLeads) {
    if (nudgedPhones.has(lead.phone)) continue;

    const hinglish = isHinglish(lead.market);

    await sendWhatsApp(lead.phone, 'reengagement_v1', [
      lead.name || (hinglish ? 'there' : 'there'),
      hinglish
        ? 'Abhi bhi interested ho fitness mein? Maddy ka $20 trial session try karo - ek Zoom call aur pura plan milega!'
        : "Still interested in getting fit? Try Maddy's $20 trial session - one Zoom call and a complete plan!",
    ]);

    nudged++;
  }

  return res.status(200).json({ ok: true, nudged });
};
