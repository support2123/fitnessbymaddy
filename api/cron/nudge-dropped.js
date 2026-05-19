const { supabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();

    // FLOW A step 3: Nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
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

        const canSend = await checkRateLimit(lead.phone, false);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
        console.log(`[Nudge] Trial nudge sent to ${maskPhone(lead.phone)}`);
      }
    }

    // FLOW A step 4: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo.toISOString());

    let dropped = 0;
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

        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        console.log(`[Nudge] Dropped stale lead: ${maskPhone(lead.phone)}`);
      }
    }

    // Re-engage dropped leads (7-day cool-off)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: outMsgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (outMsgs && outMsgs.length > 0) continue;

        const canSend = await checkRateLimit(lead.phone, false);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reEngaged++;
      }
    }

    console.log(`[NudgeDropped] Nudged: ${nudged}, Dropped: ${dropped}, Re-engaged: ${reEngaged}`);

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      re_engaged: reEngaged,
    });
  } catch (error) {
    console.error('[NudgeDropped Error]', error.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
