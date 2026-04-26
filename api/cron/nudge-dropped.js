const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of leads) {
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const isIN = lead.market === 'IN';

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: isIN
          ? [
              lead.name || 'there',
              'Ek $20 zoom trial session se start karein — koi commitment nahi!',
              'https://fitnessbymaddy.com/program-trial.html'
            ]
          : [
              lead.name || 'there',
              'Start with a $20 zoom trial session — no commitment needed!',
              'https://fitnessbymaddy.com/program-trial.html'
            ]
      });

      sent++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged: sent,
      stale_dropped: staleLeads?.length || 0
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
