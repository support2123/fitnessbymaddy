const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const supabase = getSupabase();

  // Find leads dropped exactly 7 days ago (give them a 2nd chance)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', eightDaysAgo.toISOString())
    .lte('last_msg_at', sevenDaysAgo.toISOString());

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ message: 'No leads to nudge' });
  }

  const results = [];

  for (const lead of droppedLeads) {
    // Only nudge once - check if we already sent a re-engagement
    const { data: prevNudge } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (prevNudge && prevNudge.length > 0) {
      continue;
    }

    const market = lead.market || 'GLOBAL';
    const msg = market === 'IN'
      ? ['Maddy ka $20 trial abhi bhi available hai — 1 Zoom session mein dekho results possible hai ya nahi. No commitment 🙌']
      : ['Maddy\'s $20 trial is still available — see what\'s possible in just 1 Zoom session. No commitment 🙌'];

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'reengage_7day',
      params: msg,
    });

    results.push({ lead_id: lead.id, phone: lead.phone });
  }

  return res.status(200).json({ nudged: results.length });
};
