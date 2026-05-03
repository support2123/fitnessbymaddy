const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    const nudgeResults = [];

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 2 && hoursSinceMsg < 4) {
          const result = await sendWhatsApp(
            lead.phone,
            'nudge_trial',
            [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
          );
          nudgeResults.push({ phone: lead.phone, type: 'nudge_trial', sent: result.sent });
        } else if (hoursSinceMsg >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          nudgeResults.push({ phone: lead.phone, type: 'marked_dropped' });
        }
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const result = await sendWhatsApp(
          lead.phone,
          'reengage_7day',
          [lead.name || 'there']
        );
        nudgeResults.push({ phone: lead.phone, type: 'reengage_7day', sent: result.sent });
      }
    }

    return res.status(200).json({ processed: nudgeResults.length, results: nudgeResults });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
