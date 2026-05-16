const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    let nudged = 0;
    for (const lead of reEngageLeads) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengage')
        .limit(1)
        .single();

      if (recentOut) continue;

      await sendWhatsApp(lead.phone, 'nudge_reengage', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (noReplyLeads) {
      for (const lead of noReplyLeads) {
        const { data: hasReply } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1)
          .single();

        if (hasReply) continue;

        const { data: alreadyNudged } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1)
          .single();

        if (alreadyNudged) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });

        nudged++;
      }
    }

    return res.status(200).json({ success: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
