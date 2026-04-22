const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendTo } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: newLeadsNoReply } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', twentyFourHoursAgo.toISOString());

    let nudged = 0;

    for (const lead of (newLeadsNoReply || [])) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      if (await canSendTo(lead.phone, false)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        nudged++;
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
      dropped = ids.length;
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo.toISOString());

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      if (await canSendTo(lead.phone, false)) {
        await sendTemplate(lead.phone, 'win_back', [
          lead.name || 'there',
        ]);
        reEngaged++;
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
