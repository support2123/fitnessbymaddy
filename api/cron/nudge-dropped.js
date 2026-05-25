const { getClient } = require('../../lib/supabase');
const { sendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getClient();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Phase 1: Nudge leads with no reply after 2 hours (still status=new)
    const { data: staleNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNew) {
      for (const lead of staleNew) {
        const hinglish = isHinglish(detectMarket(lead.phone));
        const trialUrl = `${process.env.SITE_URL || 'https://fitnessbymaddy.com'}/program-trial.html`;

        const msg = hinglish
          ? `Hey! 👋 Agar confused ho toh ek baar $20 trial try karo — live Zoom session Maddy ke saath.\n\nBook here: ${trialUrl}\n\nNo commitment, sirf 1 session to see if it's right for you.`
          : `Hey! 👋 If you're unsure, try our $20 trial — a live Zoom session with Maddy.\n\nBook here: ${trialUrl}\n\nNo commitment, just 1 session to see if it's right for you.`;

        await sendMessage(lead.phone, msg, {
          templateName: 'nudge_trial',
          params: {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there', trialUrl]
          }
        });
        nudged++;
      }
    }

    // Phase 2: Drop leads with no reply after 24 hours
    const { data: expired } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (expired) {
      for (const lead of expired) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Phase 3: Re-engage dropped leads older than 7 days (one-time)
    const { data: oldDropped } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (oldDropped) {
      for (const lead of oldDropped) {
        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if ((count || 0) > 0) continue;

        const hinglish = isHinglish(detectMarket(lead.phone));
        const msg = hinglish
          ? `Hi ${lead.name || 'there'}! Maddy here 👋 Pichle hafte baat reh gayi thi. Still interested in getting fit? Reply karo aur hum abhi start karte hain.`
          : `Hi ${lead.name || 'there'}! Maddy here 👋 We didn't get to connect last time. Still interested in getting fit? Reply and let's get started.`;

        await sendMessage(lead.phone, msg, {
          templateName: 'reengage_7day',
          params: {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there']
          }
        });
        reengaged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reengaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
