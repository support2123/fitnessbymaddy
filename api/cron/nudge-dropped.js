const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // New leads with no reply after 2 hours — nudge trial
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs?.length) continue;

        const market = lead.market || detectMarket(lead.phone);
        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

        const msg = market === 'IN'
          ? `Hey ${lead.name || 'there'}! 😊 Abhi decide nahi ho raha? Koi baat nahi — try karo Maddy ka $20 trial session pehle:\n\n${trialUrl}\n\nNo commitment, sirf results. 💪`
          : `Hey ${lead.name || 'there'}! 😊 Not sure yet? No worries — try Maddy's $20 trial session first:\n\n${trialUrl}\n\nNo commitment, just results. 💪`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there', trialUrl],
          body: msg,
        });

        nudged++;
      }
    }

    // Leads older than 24h with no qualification — mark dropped
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads from 7 days ago (one-time)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .lt('created_at', sevenDaysAgo)
      .gt('created_at', eightDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs?.length) continue;

        const market = lead.market || detectMarket(lead.phone);
        const msg = market === 'IN'
          ? `Hey ${lead.name || 'there'}! Maddy ka naya batch start ho raha hai. Limited spots hain — interested ho toh reply karo! 🔥`
          : `Hey ${lead.name || 'there'}! Maddy's new batch is starting soon. Limited spots — reply if you're interested! 🔥`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          params: [lead.name || 'there'],
          body: msg,
        });

        reEngaged++;
      }
    }

    return res.status(200).json({ nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
