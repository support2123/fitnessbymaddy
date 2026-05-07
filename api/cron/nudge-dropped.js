const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Flow A step 3: Nudge leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = { nudged_trial: 0, marked_dropped: 0, re_engaged: 0 };

    // New leads with no reply after 2 hours — send trial nudge
    const { data: staleNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of staleNew || []) {
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
          const templateName = isHinglishMarket(market) ? 'nudge_trial_hi' : 'nudge_trial';
          await sendTemplate(lead.phone, templateName, [
            lead.name || '',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]);
          results.nudged_trial++;
        }
      }
    }

    // Leads with no reply after 24 hours — mark dropped
    const { data: expiredNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of expiredNew || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.marked_dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time only)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    for (const lead of droppedLeads || []) {
      const { data: reengageMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (!reengageMsg || reengageMsg.length === 0) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglishMarket(market) ? 'reengage_dropped_hi' : 'reengage_dropped';
        await sendTemplate(lead.phone, templateName, [lead.name || '']);
        results.re_engaged++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
