const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reengageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('created_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!reengageLeads || reengageLeads.length === 0) {
    return res.status(200).json({ action: 'no_leads_to_nudge' });
  }

  let sent = 0;
  for (const lead of reengageLeads) {
    const { data: recentMsg } = await db
      .from('messages')
      .select('sent_at')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (recentMsg && recentMsg.length > 0) continue;

    const market = detectMarket(lead.phone);
    const template = market === 'IN' ? 'reengage_7day_hindi' : 'reengage_7day';

    await sendWhatsApp(lead.phone, template, [lead.name || 'there']);
    sent++;
  }

  return res.status(200).json({ nudged: sent });
};
