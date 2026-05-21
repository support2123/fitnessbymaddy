const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeads || [])) {
      const hoursSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        continue;
      }

      if (hoursSinceCreated >= 2) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    for (const lead of (droppedLeads || [])) {
      const templateName = isHinglish(lead.market) ? 'reengage_v1' : 'reengage_v1_en';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      reengaged++;
    }

    const { data: staleNew } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (staleNew && staleNew.length > 0) {
      const ids = staleNew.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped += staleNew.length;
    }

    return res.status(200).json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
