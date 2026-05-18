const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / 3600000;

        if (hoursSinceCreated > 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        const ok = await canSendToLead(lead.phone);
        if (!ok) continue;

        const market = lead.market || 'IN';
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';
        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        nudged++;
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const ok = await canSendToLead(lead.phone);
        if (!ok) continue;

        const market = lead.market || 'IN';
        const templateName = isHinglish(market) ? 'reengage_hi' : 'reengage_en';
        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        reengaged++;
      }
    }

    return res.json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
