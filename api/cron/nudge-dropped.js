const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Flow A step 3: Nudge leads that haven't replied in 2+ hours
    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;
    let reengaged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceCreate = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreate >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const { data: inbound } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.created_at)
          .limit(2);

        if (inbound && inbound.length > 1) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          isHinglish(lead.market) ? '$20 trial try karo!' : 'Try our $20 trial!',
          'https://www.fitnessbymaddy.com/intake?trial=1',
        ]);

        nudged++;
      }
    }

    // Flow A step 4: Drop leads older than 24 hrs with no reply
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .limit(2);

        if (!replies || replies.length <= 1) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule): one-time re-engagement after 7 days
    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, market, last_msg_at')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengageCheck } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageCheck && reengageCheck.length > 0) continue;

        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [
          isHinglish(lead.market)
            ? 'Maddy ka $20 trial abhi bhi available hai. Ready ho toh reply karo!'
            : 'Maddy\'s $20 trial is still available. Reply when you\'re ready!',
        ]);

        reengaged++;
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
