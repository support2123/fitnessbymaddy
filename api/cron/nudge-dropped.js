const { supabase, maskPhone } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    for (const lead of (leads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%nudge%');

      if ((count || 0) >= 2) continue;

      const isHinglish = lead.market === 'IN';
      const templateName = isHinglish ? 'nudge_trial' : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html'
      ]);

      reEngaged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo);

    let nudged = 0;
    for (const lead of (noReplyLeads || [])) {
      const { count: replyCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in');

      if ((replyCount || 0) > 1) continue;

      const { count: nudgeCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if ((nudgeCount || 0) >= 1) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/shred.html'
      ]);
      nudged++;
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      const { count: inCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in');

      if ((inCount || 0) <= 1) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    console.log(`Nudge cron: ${reEngaged} re-engaged, ${nudged} nudged, ${dropped} dropped`);
    return res.json({ ok: true, re_engaged: reEngaged, nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
