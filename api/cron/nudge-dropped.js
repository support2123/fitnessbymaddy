const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24 && hoursSinceMsg < 48) {
          await sendWhatsApp(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there']
          });
          nudged++;
        } else if (hoursSinceMsg >= 48) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const daysSinceDrop = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceDrop >= 5 && daysSinceDrop < 8) {
          const { data: msgs } = await supabase
            .from('messages')
            .select('template_name')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengage_7day');

          if (!msgs || msgs.length === 0) {
            await sendWhatsApp(lead.phone, 'reengage_7day', {
              name: lead.name || 'there',
              templateParams: [lead.name || 'there']
            });
            reEngaged++;
          }
        }
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reEngaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
