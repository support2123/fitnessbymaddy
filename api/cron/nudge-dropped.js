const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const db = getSupabase();
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const results = { nudge_2hr: 0, dropped_24hr: 0, reengaged_7d: 0 };

  // 2-hour nudge for new leads with no reply
  const { data: newLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  for (const lead of newLeads || []) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!replies || replies.length === 0) {
      const { data: nudges } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (!nudges || nudges.length === 0) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        await logMessage(lead.phone, 'out', 'Trial nudge', templateName);
        results.nudge_2hr++;
      }
    }
  }

  // 24-hour drop for unresponsive new leads
  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of staleLeads || []) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!replies || replies.length === 0) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped_24hr++;
    }
  }

  // 7-day re-engagement for dropped leads (only once)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', sevenDaysAgo);

  for (const lead of droppedLeads || []) {
    const { data: reengageMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7d')
      .limit(1);

    if (!reengageMsg || reengageMsg.length === 0) {
      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'reengage_7d_hi' : 'reengage_7d';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      await logMessage(lead.phone, 'out', 'Re-engagement after 7 days', templateName);
      results.reengaged_7d++;
    }
  }

  return res.status(200).json({ success: true, ...results });
};
