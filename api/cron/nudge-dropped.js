const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage, isHinglish, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // FLOW A step 3: nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(2);

      const replyCount = replies?.length || 0;

      if (replyCount <= 1) {
        const { data: nudgesSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudgesSent || nudgesSent.length === 0) {
          if (await canSendMessage(lead.phone)) {
            const market = lead.market || 'GLOBAL';
            const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';
            await sendTemplate(lead.phone, templateName, [
              lead.name || 'there',
              'https://www.fitnessbymaddy.com/program-trial.html'
            ]);
            nudged++;
          }
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engagement: 7-day old dropped leads get one final nudge
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reengaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const { data: reengageSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!reengageSent || reengageSent.length === 0) {
        if (await canSendMessage(lead.phone)) {
          await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
          reengaged++;
        }
      }
    }

    return res.json({ ok: true, nudged, dropped, reengaged });

  } catch (err) {
    console.error('[nudge-dropped] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
