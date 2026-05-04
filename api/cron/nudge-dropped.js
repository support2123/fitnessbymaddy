const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads who haven't replied in 2+ hours
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        const { data: nudges } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) continue;

        if (await canSendMessage(lead.phone)) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there'
          ]);
          nudged++;
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}`);
    return res.status(200).json({ nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
