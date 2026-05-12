const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    let nudged = 0;

    for (const lead of reEngageLeads) {
      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });
      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .lte('last_msg_at', oneDayAgo);

    if (noReplyLeads && noReplyLeads.length > 0) {
      const ids = noReplyLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    return res.status(200).json({
      success: true,
      nudged,
      auto_dropped: noReplyLeads ? noReplyLeads.length : 0
    });

  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
