const { supabase } = require('../../lib/supabase');
const { sendWithRateLimit } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    // Re-engage leads that went silent 7+ days ago but not older than 14 days
    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    let nudged = 0;
    let rateLimited = 0;

    for (const lead of droppedLeads) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const result = await sendWithRateLimit(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        hinglish
          ? 'Abhi bhi interested ho? Maddy ka $20 trial session try karo — full guidance, zero commitment 🔥'
          : 'Still interested? Try Maddy\'s $20 trial session — full guidance, zero commitment 🔥',
        'https://fitnessbymaddy.com/shred.html',
      ]);

      if (result.rateLimited) {
        rateLimited++;
      } else {
        nudged++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      }
    }

    // Also send 2-hour nudge for very new leads (no reply within 2 hrs)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const { data: freshLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', fourHoursAgo);

    if (freshLeads) {
      for (const lead of freshLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await sendWithRateLimit(lead.phone, 'nudge_trial', [
            lead.name || 'there',
          ]);
        }
      }
    }

    // Mark 24hr+ silent leads as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo)
      .lt('created_at', oneDayAgo);

    return res.status(200).json({ ok: true, nudged, rateLimited });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
