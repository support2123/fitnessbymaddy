const { getSupabase } = require('../_lib/supabase');
const { canSendMessage, sendTemplate } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2-hour nudge for new leads
    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;
    let reEngaged = 0;

    for (const lead of (newLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      if (await canSendMessage(lead.phone, false)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/trial.html'
        ]);
        nudged++;
      }
    }

    // 24-hour drop for unresponsive leads
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      const { data: inbound } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!inbound || inbound.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // 7-day re-engagement for dropped leads (one attempt only)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    for (const lead of (droppedLeads || [])) {
      const { data: reengageMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (reengageMsgs && reengageMsgs.length > 0) continue;

      if (await canSendMessage(lead.phone, false)) {
        const hinglish = isHinglishMarket(lead.market);
        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there',
          hinglish ? 'Kya plan hai fitness ka? Maddy ka $20 trial abhi available hai!' : 'Still thinking about your fitness goals? Maddy\'s $20 trial is available!'
        ]);
        reEngaged++;
      }
    }

    return res.status(200).json({ nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
