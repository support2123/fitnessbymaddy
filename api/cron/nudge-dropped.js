const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // Nudge leads who haven't replied in 2 hours (status=new)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Drop leads with no reply after 24 hours
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    // Nudge new leads after 2 hours with no reply
    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        await logMessage(lead.phone, 'out', null, 'nudge_trial');
        nudged++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time attempt)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', null, 'reengage_7day');
        reengaged++;
      }
    }

    return res.status(200).json({ success: true, nudged, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
