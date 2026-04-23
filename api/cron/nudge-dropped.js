const { supabase } = require('../_lib/supabase');
const { maskPhone, isHinglish } = require('../_lib/helpers');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ status: 'ok', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const canSend = await canSendToLead(lead.phone);
      if (!canSend) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;

      console.log(`[Cron:Nudge] Re-engaged ${maskPhone(lead.phone)}`);
    }

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    for (const lead of (newLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .limit(2);

      if (msgs && msgs.length >= 2) continue;

      const canSend = await canSendToLead(lead.phone);
      if (!canSend) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    console.log(`[Cron:Nudge] Total nudged: ${nudged}`);
    return res.json({ status: 'ok', nudged });
  } catch (err) {
    console.error('[Cron:Nudge Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
